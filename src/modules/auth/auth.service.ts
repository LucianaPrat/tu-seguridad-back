import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { normalizeEmail } from '../../cross/common/normalize-email';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { PasswordHashService } from '../../cross/crypto/password-hash.service';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { SpaceAccessorService } from '../../data/accessors/space.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { MeDto } from './dto/me.dto';
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
  ) {}

  /**
   * Every rejection answers with the same message: a wrong password, a
   * deactivated account and an account with no membership are indistinguishable
   * from outside, so login cannot be used to probe account state.
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

    const member = await this.spaceMemberAccessor.findByUserId(user.id);
    if (!member) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    await this.userAccessor.recordLogin(user.id);
    return buildData(await this.sessionService.issue(user, member, context));
  }

  async register(
    dto: RegisterDto,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
    const email = normalizeEmail(dto.email);
    if (await this.userAccessor.findByEmail(email)) {
      return buildError(ErrorCode.CONFLICT, 'Email is already registered');
    }

    const passwordHash = await this.passwordHash.hash(dto.password);
    try {
      const owned = await this.spaceAccessor.createWithOwner({
        user: {
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          profileCompleted: true,
          lastLoginAt: new Date(),
        },
        spaceName: dto.spaceName,
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

  async me(userId: number): Promise<Either<MeDto>> {
    const session = await this.sessionService.loadActiveMembership(userId);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    const space = await this.spaceAccessor.findById(session.member.spaceId);
    if (!space) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    const { user, member } = session;
    return buildData({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      profileCompleted: user.profileCompleted,
      spaceId: space.id,
      spaceName: space.name,
      role: member.role,
      receiveAlerts: member.receiveAlerts,
    });
  }
}
