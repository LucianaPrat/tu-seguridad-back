import { Injectable } from '@nestjs/common';
import { Locale, SpaceMemberRole, User } from '@prisma/client';
import {
  CredentialTtl,
  ErrorCode,
  InvitationMessage,
} from '../../cross/common/constants';
import type { AccessTokenClaims } from '../../cross/common/jwt-payload.type';
import { normalizeEmail } from '../../cross/common/normalize-email';
import {
  DEFAULT_MENU_ACCESS,
  MenuKey,
  toMemberPermissions,
} from '../../cross/common/permissions';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { SecretTokenService } from '../../cross/crypto/secret-token.service';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import {
  InvitationAccessorService,
  InvitationRecord,
} from '../../data/accessors/invitation.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CredentialDeliveryPort } from '../auth/credential-delivery.port';
import { TokenPairDto } from '../auth/dto/token-pair.dto';
import { SessionService } from '../auth/session.service';
import { InvitationListDto } from './dto/invitation-list.dto';
import {
  InvitationPreviewDto,
  MyInvitationDto,
} from './dto/invitation-preview.dto';
import { InvitationDto } from './dto/invitation.dto';
import { invitedByName, toInvitationDto } from './invitation.mapper';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InviteInput {
  email: string;
  role: SpaceMemberRole;
  menuAccess?: MenuKey[];
  cameraIds?: string[];
  /** Defaults to the inviter's own locale. */
  locale?: Locale;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitationAccessor: InvitationAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly secretToken: SecretTokenService,
    private readonly sessionService: SessionService,
    private readonly delivery: CredentialDeliveryPort,
  ) {}

  /**
   * One usable pending invitation per space and address. The table deliberately
   * has no unique `(space_id, email)` — that would block ever inviting the same
   * person again after an expiry — so the rule is enforced here. Belonging to
   * another space is no obstacle: an account can be a member of several.
   */
  async create(
    spaceId: string,
    invitedByUserId: number,
    input: InviteInput,
  ): Promise<Either<InvitationDto>> {
    const email = normalizeEmail(input.email);

    const existingUser = await this.userAccessor.findByEmail(email);
    if (
      existingUser &&
      (await this.spaceMemberAccessor.findBySpaceAndUser(
        spaceId,
        existingUser.id,
      ))
    ) {
      return buildError(
        ErrorCode.CONFLICT,
        'This user is already a member of the space',
      );
    }
    if (
      await this.invitationAccessor.findPendingBySpaceAndEmail(spaceId, email)
    ) {
      return buildError(
        ErrorCode.CONFLICT,
        'An invitation for this email is already pending',
      );
    }

    // Checked against the space's own cameras: an id from another tenant must
    // not be grantable by guessing it.
    const cameraIds = input.cameraIds ?? [];
    if (cameraIds.length > 0) {
      const own = new Set(
        (await this.cameraAccessor.findAll(spaceId)).map((camera) => camera.id),
      );
      if (!cameraIds.every((id) => own.has(id))) {
        return buildError(
          ErrorCode.VALIDATION_ERROR,
          'cameraIds must belong to cameras of this space',
        );
      }
    }

    const token = this.secretToken.generate();
    const expiresAt = this.newExpiry();
    const invitation = await this.invitationAccessor.create({
      spaceId,
      email,
      token,
      invitedByUserId,
      expiresAt,
      role: input.role,
      menuAccess: input.menuAccess ?? DEFAULT_MENU_ACCESS[input.role],
      cameraIds,
      locale:
        input.locale ??
        (await this.userAccessor.findById(invitedByUserId))?.locale,
    });
    await this.deliver(invitation, token);

    return buildData(toInvitationDto(invitation));
  }

  /** The list only carries the invitations an admin can still expect to be used. */
  async findPending(spaceId: string): Promise<Either<InvitationListDto>> {
    const invitations =
      await this.invitationAccessor.findPendingBySpace(spaceId);
    const items = invitations.map(toInvitationDto);
    return buildData({ items, total: items.length });
  }

  async revoke(spaceId: string, id: string): Promise<Either<null>> {
    const invitation = await this.invitationAccessor.findPendingById(
      id,
      spaceId,
    );
    if (!invitation || !(await this.invitationAccessor.revoke(id))) {
      return buildError(ErrorCode.NOT_FOUND, InvitationMessage.NOT_FOUND);
    }
    return buildData(null);
  }

  async resend(spaceId: string, id: string): Promise<Either<InvitationDto>> {
    const pending = await this.invitationAccessor.findPendingById(id, spaceId);
    if (!pending) {
      return buildError(ErrorCode.NOT_FOUND, InvitationMessage.NOT_FOUND);
    }
    const token = this.secretToken.generate();
    const invitation = await this.invitationAccessor.renew(
      id,
      token,
      this.newExpiry(),
    );
    await this.deliver(invitation, token);
    return buildData(toInvitationDto(invitation));
  }

  async preview(token: string): Promise<Either<InvitationPreviewDto>> {
    const invitation = await this.invitationAccessor.findPendingByToken(token);
    if (!invitation) {
      return buildError(ErrorCode.NOT_FOUND, InvitationMessage.NOT_FOUND);
    }
    const user = await this.userAccessor.findByEmail(invitation.email);
    return buildData({
      id: invitation.id,
      spaceName: invitation.space.name,
      invitedByName: invitedByName(invitation),
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      userExists: user !== null,
    });
  }

  async findMine(email: string): Promise<Either<MyInvitationDto[]>> {
    const invitations =
      await this.invitationAccessor.findPendingForEmail(email);
    return buildData(
      invitations.map((invitation) => ({
        id: invitation.id,
        spaceId: invitation.spaceId,
        spaceName: invitation.space.name,
        invitedByName: invitedByName(invitation),
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      })),
    );
  }

  /**
   * Joins the caller to the inviting space and moves the session there. The
   * caller proves the address by being signed in as it, so no token is needed.
   */
  async accept(
    claims: AccessTokenClaims,
    id: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const owned = await this.loadOwnPending(claims.sub, id);
    if (!owned.ok) {
      return owned;
    }
    const { user, invitation } = owned.data;

    const { menuAccess, cameraIds } = toMemberPermissions(invitation);
    const member = await this.invitationAccessor.accept(invitation.id, {
      spaceId: invitation.spaceId,
      userId: user.id,
      role: invitation.role,
      // Json columns: sanitized on the way out, and a missing menu falls back to
      // what the role gets by default rather than to no access at all.
      menuAccess:
        invitation.menuAccess == null
          ? DEFAULT_MENU_ACCESS[invitation.role]
          : menuAccess,
      cameraIds,
      invitedByUserId: invitation.invitedByUserId,
      receiveAlerts: invitation.role !== SpaceMemberRole.guest,
    });
    if (!member) {
      // Lost the race against a revoke, a decline or a second accept.
      return buildError(ErrorCode.CONFLICT, InvitationMessage.NO_LONGER_VALID);
    }
    return buildData(await this.sessionService.issue(user, member, context));
  }

  async decline(claims: AccessTokenClaims, id: string): Promise<Either<null>> {
    const owned = await this.loadOwnPending(claims.sub, id);
    if (!owned.ok) {
      return owned;
    }
    if (!(await this.invitationAccessor.decline(id))) {
      return buildError(ErrorCode.CONFLICT, InvitationMessage.NO_LONGER_VALID);
    }
    return buildData(null);
  }

  /** Shared gate of accept and decline: pending first, then addressed to the caller. */
  private async loadOwnPending(
    userId: number,
    id: string,
  ): Promise<Either<{ user: User; invitation: InvitationRecord }>> {
    const [user, invitation] = await Promise.all([
      this.userAccessor.findById(userId),
      this.invitationAccessor.findPendingById(id),
    ]);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, 'Invalid or expired session');
    }
    if (!invitation) {
      return buildError(ErrorCode.CONFLICT, InvitationMessage.NO_LONGER_VALID);
    }
    if (invitation.email !== user.email) {
      return buildError(ErrorCode.FORBIDDEN, InvitationMessage.EMAIL_MISMATCH);
    }
    return buildData({ user, invitation });
  }

  private newExpiry(): Date {
    return new Date(Date.now() + CredentialTtl.INVITATION_DAYS * DAY_MS);
  }

  private deliver(invitation: InvitationRecord, token: string): Promise<void> {
    return this.delivery.deliver({
      purpose: 'invitation',
      email: invitation.email,
      token,
      expiresAt: invitation.expiresAt,
      locale: invitation.locale,
      invitation: {
        spaceName: invitation.space.name,
        inviterName: invitedByName(invitation),
        role: invitation.role,
      },
    });
  }
}
