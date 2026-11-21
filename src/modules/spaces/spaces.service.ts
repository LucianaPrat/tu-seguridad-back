import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../cross/common/constants';
import type { AccessTokenClaims } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { SpaceAccessorService } from '../../data/accessors/space.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { TokenPairDto } from '../auth/dto/token-pair.dto';
import { SessionService } from '../auth/session.service';
import { SpaceSummaryDto } from './dto/space-summary.dto';

@Injectable()
export class SpacesService {
  constructor(
    private readonly spaceAccessor: SpaceAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly sessionService: SessionService,
  ) {}

  async list(claims: AccessTokenClaims): Promise<Either<SpaceSummaryDto[]>> {
    const memberships =
      await this.spaceMemberAccessor.findManyByUserIdWithSpace(claims.sub);
    return buildData(
      memberships.map((member) => ({
        id: member.space.id,
        name: member.space.name,
        role: member.role,
      })),
    );
  }

  /** The new space becomes the session's space: creating one means working in it. */
  async create(
    claims: AccessTokenClaims,
    name: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const user = await this.userAccessor.findById(claims.sub);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, 'Invalid session');
    }
    const { member } = await this.spaceAccessor.createSpaceForUser(
      user.id,
      name,
    );
    return buildData(await this.sessionService.issue(user, member, context));
  }

  async rename(
    spaceId: string,
    role: SpaceSummaryDto['role'],
    name: string,
  ): Promise<Either<SpaceSummaryDto>> {
    const space = await this.spaceAccessor.rename(spaceId, name);
    return buildData({ id: space.id, name: space.name, role });
  }

  async remove(
    userId: number,
    spaceId: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    if (await this.dvrAccessor.findBySpaceId(spaceId)) {
      return buildError(
        ErrorCode.CONFLICT,
        'Remove the DVR before deleting the space',
      );
    }
    await this.spaceAccessor.deleteEmpty(spaceId);

    // Falls to another membership, or to none — the account survives either way.
    const session = await this.sessionService.loadActiveMembership(userId);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, 'Invalid session');
    }
    return buildData(
      await this.sessionService.issue(session.user, session.member, context),
    );
  }
}
