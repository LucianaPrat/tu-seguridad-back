import { Injectable } from '@nestjs/common';
import { CredentialTtl, ErrorCode } from '../../cross/common/constants';
import { normalizeEmail } from '../../cross/common/normalize-email';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { PasswordHashService } from '../../cross/crypto/password-hash.service';
import { SecretTokenService } from '../../cross/crypto/secret-token.service';
import { InvitationAccessorService } from '../../data/accessors/invitation.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CredentialDeliveryPort } from '../auth/credential-delivery.port';
import { TokenPairDto } from '../auth/dto/token-pair.dto';
import { SessionService } from '../auth/session.service';
import { InvitationDto } from './dto/invitation.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_INVITATION_MESSAGE = 'Invalid or expired invitation';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitationAccessor: InvitationAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly passwordHash: PasswordHashService,
    private readonly secretToken: SecretTokenService,
    private readonly sessionService: SessionService,
    private readonly delivery: CredentialDeliveryPort,
  ) {}

  /**
   * One usable pending invitation per space and address. The table deliberately
   * has no unique `(space_id, email)` — that would block ever inviting the same
   * person again after an expiry — so the rule is enforced here.
   */
  async create(
    spaceId: string,
    invitedByUserId: number,
    email: string,
  ): Promise<Either<InvitationDto>> {
    const normalizedEmail = normalizeEmail(email);

    const existingUser = await this.userAccessor.findByEmail(normalizedEmail);
    if (existingUser) {
      const membership = await this.spaceMemberAccessor.findByUserId(
        existingUser.id,
      );
      if (membership) {
        return buildError(
          ErrorCode.CONFLICT,
          'This user already belongs to a space',
        );
      }
    }

    const pending = await this.invitationAccessor.findPendingBySpaceAndEmail(
      spaceId,
      normalizedEmail,
    );
    if (pending) {
      return buildError(
        ErrorCode.CONFLICT,
        'An invitation for this email is already pending',
      );
    }

    const token = this.secretToken.generate();
    const expiresAt = new Date(
      Date.now() + CredentialTtl.INVITATION_DAYS * DAY_MS,
    );
    const invitation = await this.invitationAccessor.create({
      spaceId,
      email: normalizedEmail,
      token,
      invitedByUserId,
      expiresAt,
    });
    await this.delivery.deliver({
      purpose: 'invitation',
      email: normalizedEmail,
      token,
      expiresAt,
    });

    return buildData({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });
  }

  /**
   * Acceptance logs the invitee straight in, which is what the delivered link
   * promises. A brand-new account arrives with no name, phone or usable password,
   * so its session is `profileCompleted: false` and the global gate keeps it on
   * profile completion until it fills those in.
   */
  async accept(
    token: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const invitation = await this.invitationAccessor.findUsableByToken(token);
    if (!invitation) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_INVITATION_MESSAGE);
    }

    const existingUser = await this.userAccessor.findByEmail(invitation.email);
    if (existingUser) {
      return this.acceptAsExistingUser(token, existingUser.id, context);
    }

    // The placeholder is a discarded random secret, not an empty or guessable
    // hash: nothing can authenticate with it until profile completion sets a
    // real password.
    const placeholderPasswordHash = await this.passwordHash.hash(
      this.secretToken.generate(),
    );
    const accepted = await this.invitationAccessor.acceptWithNewUser({
      token,
      email: invitation.email,
      passwordHash: placeholderPasswordHash,
    });
    if (!accepted) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_INVITATION_MESSAGE);
    }

    return buildData(
      await this.sessionService.issue(accepted.user, accepted.member, context),
    );
  }

  private async acceptAsExistingUser(
    token: string,
    userId: number,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const user = await this.userAccessor.findById(userId);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_INVITATION_MESSAGE);
    }

    const membership = await this.spaceMemberAccessor.findByUserId(userId);
    if (membership) {
      return buildError(
        ErrorCode.CONFLICT,
        'This user already belongs to a space',
      );
    }

    const accepted = await this.invitationAccessor.acceptWithExistingUser(
      token,
      userId,
    );
    if (!accepted) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_INVITATION_MESSAGE);
    }

    return buildData(
      await this.sessionService.issue(user, accepted.member, context),
    );
  }
}
