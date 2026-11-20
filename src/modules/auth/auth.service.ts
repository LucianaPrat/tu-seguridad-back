import { Injectable } from '@nestjs/common';
import { Prisma, Space, SpaceMember } from '@prisma/client';
import { ErrorCode, InvitationMessage } from '../../cross/common/constants';
import { normalizeEmail } from '../../cross/common/normalize-email';
import { toMemberPermissions } from '../../cross/common/permissions';
import type { AccessTokenClaims } from '../../cross/common/jwt-payload.type';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { PasswordHashService } from '../../cross/crypto/password-hash.service';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { InvitationAccessorService } from '../../data/accessors/invitation.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { SpaceAccessorService } from '../../data/accessors/space.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { MeDto } from './dto/me.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { SessionService } from './session.service';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const UNIQUE_CONSTRAINT_ERROR = 'P2002';

@Injectable()
export class AuthService {
  constructor(
    private readonly userAccessor: UserAccessorService,
    private readonly spaceAccessor: SpaceAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly passwordHash: PasswordHashService,
    private readonly sessionService: SessionService,
    private readonly invitationAccessor: InvitationAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
  ) {}

  /**
   * Every rejection answers with the same message: a wrong password, a
   * deactivated account are indistinguishable from outside, so login cannot be used to probe account state.
   */
  async login(
    email: string,
    password: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const user = await this.userAccessor.findByEmail(normalizeEmail(email));
    if (!user) {
      // Pays what a found account pays. The bodies were already identical; the
      // clock was not, and that is what made login an enumeration oracle.
      await this.passwordHash.verifyAgainstDummy(password);
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.passwordHash.verify(
      password,
      user.passwordHash,
    );
    if (!passwordMatches || !user.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    // An account in no space still logs in; it just gets a session scoped to
    // nothing until it creates or joins one.
    const session = await this.sessionService.loadActiveMembership(user.id);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    await this.userAccessor.recordLogin(user.id);
    return buildData(
      await this.sessionService.issue(user, session.member, context),
    );
  }

  async register(
    dto: RegisterDto,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const email = normalizeEmail(dto.email);

    // Checked before the address is probed: a bad or foreign token must answer
    // the same whether or not the address already has an account.
    if (dto.inviteToken) {
      const invitation = await this.invitationAccessor.findPendingByToken(
        dto.inviteToken,
      );
      if (!invitation) {
        return buildError(ErrorCode.NOT_FOUND, InvitationMessage.NOT_FOUND);
      }
      if (invitation.email !== email) {
        return buildError(
          ErrorCode.FORBIDDEN,
          InvitationMessage.EMAIL_MISMATCH,
        );
      }
    }
    if (await this.userAccessor.findByEmail(email)) {
      return buildError(ErrorCode.CONFLICT, 'Email is already registered');
    }

    const passwordHash = await this.passwordHash.hash(dto.password);
    const profile = {
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      profileCompleted: true,
      lastLoginAt: new Date(),
      locale: dto.locale,
    };
    try {
      if (dto.inviteToken) {
        // No space and no membership: the invitation stays pending and the
        // client accepts it next, which is what creates the membership.
        const user = await this.userAccessor.create(profile);
        return buildData(await this.sessionService.issue(user, null, context));
      }
      const owned = await this.spaceAccessor.createWithOwner({
        user: profile,
        // Validated by RegisterDto: required whenever there is no inviteToken.
        spaceName: dto.spaceName!,
      });
      return buildData(
        await this.sessionService.issue(owned.user, owned.member, context),
      );
    } catch (error) {
      // Two registrations racing on one address: the unique index is the
      // arbiter, and the loser gets the domain error rather than a driver code.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_ERROR
      ) {
        return buildError(ErrorCode.CONFLICT, 'Email is already registered');
      }
      throw error;
    }
  }

  /**
   * Closes the gate an invited account is behind. Issues a fresh pair because
   * `profileCompleted` is a token claim — the caller's current access token still
   * says the profile is incomplete.
   */
  async completeProfile(
    userId: number,
    dto: CompleteProfileDto,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const session = await this.sessionService.loadActiveMembership(userId);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }
    if (session.user.profileCompleted) {
      return buildError(ErrorCode.CONFLICT, 'Profile is already completed');
    }

    const user = await this.userAccessor.completeProfile(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      avatarUrl: dto.avatarUrl,
      passwordHash: await this.passwordHash.hash(dto.password),
    });
    return buildData(
      await this.sessionService.issue(user, session.member, context),
    );
  }

  /**
   * Moves the session into another space the caller belongs to. Membership is
   * checked against the database, not the token: the target is a client choice.
   */
  async switchSpace(
    claims: AccessTokenClaims,
    spaceId: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const member = await this.spaceMemberAccessor.findBySpaceAndUser(
      spaceId,
      claims.sub,
    );
    if (!member) {
      return buildError(
        ErrorCode.FORBIDDEN,
        'You are not a member of this space',
      );
    }
    const user = await this.userAccessor.findById(claims.sub);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }
    return buildData(await this.sessionService.issue(user, member, context));
  }

  async updateMe(
    claims: AccessTokenClaims,
    dto: UpdateMeDto,
  ): Promise<Either<MeDto>> {
    const user = await this.userAccessor.findById(claims.sub);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }
    await this.userAccessor.setLocale(user.id, dto.locale);
    return this.me(claims);
  }

  async me(claims: AccessTokenClaims): Promise<Either<MeDto>> {
    const user = await this.userAccessor.findById(claims.sub);
    if (!user?.isActive) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    // Role comes from the membership row, never from the token.
    let space: Space | null = null;
    let member: SpaceMember | null = null;
    if (claims.spaceId) {
      [space, member] = await Promise.all([
        this.spaceAccessor.findById(claims.spaceId),
        this.spaceMemberAccessor.findBySpaceAndUser(claims.spaceId, user.id),
      ]);
      if (!space || !member) {
        return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
      }
    }

    const [memberships, pendingInvitationsCount, dvr] = await Promise.all([
      this.spaceMemberAccessor.findManyByUserIdWithSpace(user.id),
      this.invitationAccessor.countPendingForEmail(user.email),
      space ? this.dvrAccessor.findBySpaceId(space.id) : null,
    ]);

    return buildData({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      locale: user.locale,
      profileCompleted: user.profileCompleted,
      spaceId: space?.id ?? null,
      spaceName: space?.name ?? null,
      role: member?.role ?? null,
      receiveAlerts: member?.receiveAlerts ?? false,
      spaces: memberships.map((entry) => ({
        id: entry.space.id,
        name: entry.space.name,
        role: entry.role,
      })),
      currentSpace:
        space && member
          ? {
              id: space.id,
              name: space.name,
              role: member.role,
              hasDvr: dvr !== null,
              ...toMemberPermissions(member),
            }
          : null,
      pendingInvitationsCount,
    });
  }
}
