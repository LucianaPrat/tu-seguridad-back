import { Injectable } from '@nestjs/common';
import { CredentialTtl, ErrorCode } from '../../cross/common/constants';
import { normalizeEmail } from '../../cross/common/normalize-email';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { PasswordHashService } from '../../cross/crypto/password-hash.service';
import { SecretTokenService } from '../../cross/crypto/secret-token.service';
import { AuthTokenAccessorService } from '../../data/accessors/auth-token.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CredentialDeliveryPort } from './credential-delivery.port';
import { AcknowledgementDto } from './dto/acknowledgement.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { SessionService } from './session.service';

const MINUTE_MS = 60 * 1000;
const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';
const ACCEPTED: AcknowledgementDto = { accepted: true };

/**
 * Password reset and magic-link login. Both request routes answer identically
 * for a registered and an unregistered address — the UI is written never to
 * reveal which is which, and a 404 here would reveal it for us.
 */
@Injectable()
export class CredentialRecoveryService {
  constructor(
    private readonly userAccessor: UserAccessorService,
    private readonly authTokenAccessor: AuthTokenAccessorService,
    private readonly passwordHash: PasswordHashService,
    private readonly secretToken: SecretTokenService,
    private readonly sessionService: SessionService,
    private readonly delivery: CredentialDeliveryPort,
  ) {}

  async requestPasswordReset(
    email: string,
  ): Promise<Either<AcknowledgementDto>> {
    await this.issueOneTimeCredential(
      email,
      'password_reset',
      CredentialTtl.PASSWORD_RESET_MINUTES,
    );
    return buildData(ACCEPTED);
  }

  /**
   * The write is one transaction in the accessor: burn the token, store the new
   * hash, revoke every refresh token. A reset that left old sessions alive would
   * not lock out whoever the reset was prompted by.
   */
  async confirmPasswordReset(
    token: string,
    password: string,
  ): Promise<Either<AcknowledgementDto>> {
    const passwordHash = await this.passwordHash.hash(password);
    const userId = await this.authTokenAccessor.consumePasswordReset(
      token,
      passwordHash,
    );
    if (userId === null) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_TOKEN_MESSAGE);
    }
    return buildData(ACCEPTED);
  }

  async requestMagicLink(email: string): Promise<Either<AcknowledgementDto>> {
    await this.issueOneTimeCredential(
      email,
      'magic_link',
      CredentialTtl.MAGIC_LINK_MINUTES,
    );
    return buildData(ACCEPTED);
  }

  async consumeMagicLink(
    token: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const authToken = await this.authTokenAccessor.findUsableByToken(
      'magic_link',
      token,
    );
    if (!authToken) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_TOKEN_MESSAGE);
    }

    const session = await this.sessionService.loadActiveMembership(
      authToken.userId,
    );
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_TOKEN_MESSAGE);
    }

    // Burn before issuing: a link that failed to produce a session is safer than
    // a link that can produce a second one.
    const consumed = await this.authTokenAccessor.consume('magic_link', token);
    if (!consumed) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_TOKEN_MESSAGE);
    }

    await this.userAccessor.recordLogin(session.user.id);
    return buildData(
      await this.sessionService.issue(session.user, session.member, context),
    );
  }

  private async issueOneTimeCredential(
    email: string,
    purpose: 'magic_link' | 'password_reset',
    ttlMinutes: number,
  ): Promise<void> {
    const user = await this.userAccessor.findByEmail(normalizeEmail(email));
    if (!user?.isActive) {
      return;
    }

    const token = this.secretToken.generate();
    const expiresAt = new Date(Date.now() + ttlMinutes * MINUTE_MS);
    await this.authTokenAccessor.create({
      userId: user.id,
      purpose,
      token,
      expiresAt,
    });
    await this.delivery.deliver({
      purpose,
      email: user.email,
      token,
      expiresAt,
    });
  }
}
