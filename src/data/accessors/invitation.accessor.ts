import { Injectable } from '@nestjs/common';
import { Invitation, SpaceMember, User } from '@prisma/client';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';

/** Every column except the token hash, which never leaves the accessor. */
const PUBLIC_FIELDS = {
  id: true,
  spaceId: true,
  email: true,
  invitedByUserId: true,
  expiresAt: true,
  acceptedAt: true,
  createdUserId: true,
  createdAt: true,
} as const;

export interface CreateInvitationInput {
  spaceId: string;
  email: string;
  token: string;
  invitedByUserId: number;
  expiresAt: Date;
}

export type InvitationRecord = Omit<Invitation, 'tokenHash'>;

export interface AcceptWithNewUserInput {
  token: string;
  email: string;
  passwordHash: string;
}

export interface AcceptedInvitation {
  invitation: InvitationRecord;
  member: SpaceMember;
  user: User;
}

@Injectable()
export class InvitationAccessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialHash: CredentialHashService,
  ) {}

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    const invitation = await this.prisma.invitation.create({
      data: {
        spaceId: input.spaceId,
        email: input.email.toLowerCase(),
        tokenHash: this.credentialHash.hashInvitation(input.token),
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      },
    });
    return this.withoutHash(invitation);
  }

  async findUsableByToken(
    token: string,
    now = new Date(),
  ): Promise<InvitationRecord | null> {
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        tokenHash: this.credentialHash.hashInvitation(token),
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });
    return invitation ? this.withoutHash(invitation) : null;
  }

  async consume(
    token: string,
    createdUserId: number,
    now = new Date(),
  ): Promise<boolean> {
    const result = await this.prisma.invitation.updateMany({
      where: {
        tokenHash: this.credentialHash.hashInvitation(token),
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now, createdUserId },
    });
    return result.count === 1;
  }

  findPendingBySpaceAndEmail(
    spaceId: string,
    email: string,
    now = new Date(),
  ): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findFirst({
      where: {
        spaceId,
        email: email.toLowerCase(),
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Pending invitations of a space: unaccepted and unexpired, newest first. Reuses
   * `PUBLIC_FIELDS` so the token hash never leaves the accessor.
   */
  findPendingBySpace(
    spaceId: string,
    now = new Date(),
  ): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({
      where: { spaceId, acceptedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Acceptance for an address with no account yet: the user, its membership and
   * the invitation's consumption are one write. A user created without its
   * membership could not sign in, and a consumed invitation with no user would
   * be unrecoverable — the raw token exists only in the delivered link.
   *
   * The invitation is re-checked inside the transaction, so two clicks on the
   * same link produce one member and one `null`.
   */
  acceptWithNewUser(
    input: AcceptWithNewUserInput,
    now = new Date(),
  ): Promise<AcceptedInvitation | null> {
    return this.prisma.$transaction(async (transaction) => {
      const consumable = await transaction.invitation.updateMany({
        where: {
          tokenHash: this.credentialHash.hashInvitation(input.token),
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (consumable.count !== 1) {
        return null;
      }

      const invitation = await transaction.invitation.findFirstOrThrow({
        where: { tokenHash: this.credentialHash.hashInvitation(input.token) },
        select: PUBLIC_FIELDS,
      });
      const user = await transaction.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          // The account has no name, phone or password of its own until it
          // completes its profile, and `profile_completed` is what gates it.
          firstName: '',
          lastName: '',
          phone: '',
        },
      });
      const member = await transaction.spaceMember.create({
        data: {
          spaceId: invitation.spaceId,
          userId: user.id,
          role: 'member',
          invitedByUserId: invitation.invitedByUserId,
        },
      });
      await transaction.invitation.update({
        where: { id: invitation.id },
        data: { createdUserId: user.id },
      });
      return {
        invitation: { ...invitation, createdUserId: user.id },
        member,
        user,
      };
    });
  }

  /**
   * Acceptance by an address that already has an account and no membership: link
   * it, consume the invitation, leave the credentials alone.
   */
  acceptWithExistingUser(
    token: string,
    userId: number,
    now = new Date(),
  ): Promise<Omit<AcceptedInvitation, 'user'> | null> {
    return this.prisma.$transaction(async (transaction) => {
      const consumable = await transaction.invitation.updateMany({
        where: {
          tokenHash: this.credentialHash.hashInvitation(token),
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now, createdUserId: userId },
      });
      if (consumable.count !== 1) {
        return null;
      }

      const invitation = await transaction.invitation.findFirstOrThrow({
        where: { tokenHash: this.credentialHash.hashInvitation(token) },
        select: PUBLIC_FIELDS,
      });
      const member = await transaction.spaceMember.create({
        data: {
          spaceId: invitation.spaceId,
          userId,
          role: 'member',
          invitedByUserId: invitation.invitedByUserId,
        },
      });
      return { invitation, member };
    });
  }

  /**
   * Retention sweep. An invitation is settled once it has expired or been
   * accepted; both keep their row for the window before it goes. The accepted
   * ones are the reason the window is not zero — `createdUserId` is how a space
   * owner answers "who invited this member", and that question outlives the
   * invitation.
   */
  async deleteSettledBefore(before: Date, limit: number): Promise<number> {
    const doomed = await this.prisma.invitation.findMany({
      where: {
        OR: [{ expiresAt: { lt: before } }, { acceptedAt: { lt: before } }],
      },
      select: { id: true },
      take: limit,
    });
    if (doomed.length === 0) {
      return 0;
    }
    const { count } = await this.prisma.invitation.deleteMany({
      where: { id: { in: doomed.map((row) => row.id) } },
    });
    return count;
  }

  private withoutHash({
    tokenHash: _tokenHash,
    ...invitation
  }: Invitation): InvitationRecord {
    void _tokenHash;
    return invitation;
  }
}
