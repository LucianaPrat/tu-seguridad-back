import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../cross/common/constants';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { UserFaceIdentityAccessorService } from '../../data/accessors/user-face-identity.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { FaceIdentityDto } from './dto/face-identity.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { SessionService } from './session.service';

const UNRECOGNIZED_FACE_MESSAGE = 'Face identity is not recognized';

/**
 * Face Auth returns an opaque identifier for a recognized person; only its hash
 * is stored, so a login can look up a presented identifier without the backend
 * ever holding one. Re-enrollment revokes the previous active identity instead
 * of overwriting it, which keeps the revocation history readable.
 */
@Injectable()
export class FaceIdentityService {
  constructor(
    private readonly faceIdentityAccessor: UserFaceIdentityAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly sessionService: SessionService,
  ) {}

  async register(
    userId: number,
    faceToken: string,
  ): Promise<Either<FaceIdentityDto>> {
    const session = await this.sessionService.loadActiveMembership(userId);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, 'Account cannot be used');
    }

    const identity = await this.faceIdentityAccessor.register(
      userId,
      faceToken,
    );
    return buildData({ id: identity.id, createdAt: identity.createdAt });
  }

  async login(
    faceToken: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const identity =
      await this.faceIdentityAccessor.findActiveByToken(faceToken);
    if (!identity) {
      return buildError(ErrorCode.UNAUTHORIZED, UNRECOGNIZED_FACE_MESSAGE);
    }

    const session = await this.sessionService.loadActiveMembership(
      identity.userId,
    );
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, UNRECOGNIZED_FACE_MESSAGE);
    }

    await this.faceIdentityAccessor.recordUse(faceToken);
    await this.userAccessor.recordLogin(session.user.id);
    return buildData(
      await this.sessionService.issue(session.user, session.member, context),
    );
  }
}
