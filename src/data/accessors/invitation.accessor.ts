import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMember, SpaceMemberRole } from '@prisma/client';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { MenuKey } from '../../cross/common/permissions';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every column except the token hash, which never leaves the accessor, plus the
 * names the invitation mail and the preview need so callers never re-query them.
 */
const PUBLIC_SELECT = {
  id: true,
  spaceId: true,
  email: true,
  invitedByUserId: true,
  expiresAt: true,
  acceptedAt: true,
  createdUserId: true,
  createdAt: true,
  role: true,
  menuAccess: true,
  cameraIds: true,
  declinedAt: true,
  revokedAt: true,
  space: { select: { name: true } },
  invitedBy: { select: { firstName: true, lastName: true } },
} as const;

export type InvitationRecord = Prisma.InvitationGetPayload<{
  select: typeof PUBLIC_SELECT;
}>;

export interface CreateInvitationInput {
  spaceId: string;
  email: string;
  token: string;
  invitedByUserId: number;
  expiresAt: Date;
  role: SpaceMemberRole;
  menuAccess: MenuKey[];
  cameraIds: string[];
}

/** The single definition of "pending", shared by every read and write below. */
function pendingWhere(now: Date): Prisma.InvitationWhereInput {
  return {
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    expiresAt: { gt: now },
  };
}

@Injectable()
export class InvitationAccessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialHash: CredentialHashService,
  ) {}

  create(input: CreateInvitationInput): Promise<InvitationRecord> {
    return this.prisma.invitation.create({
      data: {
        spaceId: input.spaceId,
        email: input.email.toLowerCase(),
        tokenHash: this.credentialHash.hashInvitation(input.token),
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
        role: input.role,
        menuAccess: input.menuAccess,
        cameraIds: input.cameraIds,
      },
      select: PUBLIC_SELECT,
    });
  }

  findPendingByToken(
    token: string,
    now = new Date(),
  ): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findFirst({
      where: {
        tokenHash: this.credentialHash.hashInvitation(token),
        ...pendingWhere(now),
      },
      select: PUBLIC_SELECT,
    });
  }

  /** `spaceId` scopes the lookup for admin routes; the invitee's routes omit it. */
  findPendingById(
    id: string,
    spaceId?: string,
    now = new Date(),
  ): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findFirst({
      where: { id, ...(spaceId ? { spaceId } : {}), ...pendingWhere(now) },
      select: PUBLIC_SELECT,
    });
  }

  findPendingBySpaceAndEmail(
    spaceId: string,
    email: string,
    now = new Date(),
  ): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findFirst({
      where: { spaceId, email: email.toLowerCase(), ...pendingWhere(now) },
      select: PUBLIC_SELECT,
    });
  }

  findPendingForEmail(
    email: string,
    now = new Date(),
  ): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({
      where: { email: email.toLowerCase(), ...pendingWhere(now) },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_SELECT,
    });
  }

  countPendingForEmail(email: string, now = new Date()): Promise<number> {
    return this.prisma.invitation.count({
      where: { email: email.toLowerCase(), ...pendingWhere(now) },
    });
  }

  findPendingBySpace(
    spaceId: string,
    now = new Date(),
  ): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({
      where: { spaceId, ...pendingWhere(now) },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_SELECT,
    });
  }

  /** `false` when the invitation stopped being pending in the meantime. */
  async revoke(id: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.invitation.updateMany({
      where: { id, ...pendingWhere(now) },
      data: { revokedAt: now },
    });
    return result.count === 1;
  }

  async decline(id: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.invitation.updateMany({
      where: { id, ...pendingWhere(now) },
      data: { declinedAt: now },
    });
    return result.count === 1;
  }

  /** New token and expiry on the same row: the old link stops resolving at once. */
  renew(id: string, token: string, expiresAt: Date): Promise<InvitationRecord> {
    return this.prisma.invitation.update({
      where: { id },
      data: {
        tokenHash: this.credentialHash.hashInvitation(token),
        expiresAt,
      },
      select: PUBLIC_SELECT,
    });
  }

  /**
   * Consumes the invitation and creates the membership as one write, so a
   * membership never exists without its invitation being settled. The pending
   * re-check inside the transaction makes two clicks produce one member and one
   * `null`. An existing membership in the space is reused rather than failing,
   * which keeps accepting idempotent.
   */
  accept(
    id: string,
    member: Prisma.SpaceMemberUncheckedCreateInput,
    now = new Date(),
  ): Promise<SpaceMember | null> {
    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.invitation.updateMany({
        where: { id, ...pendingWhere(now) },
        data: { acceptedAt: now },
      });
      if (consumed.count !== 1) {
        return null;
      }
      const existing = await transaction.spaceMember.findUnique({
        where: {
          spaceId_userId: { spaceId: member.spaceId, userId: member.userId },
        },
      });
      return existing ?? transaction.spaceMember.create({ data: member });
    });
  }

  /**
   * Retention sweep. An invitation is settled once it has expired, been accepted,
   * declined or revoked; each keeps its row for the window before it goes.
   */
  async deleteSettledBefore(before: Date, limit: number): Promise<number> {
    const doomed = await this.prisma.invitation.findMany({
      where: {
        OR: [
          { expiresAt: { lt: before } },
          { acceptedAt: { lt: before } },
          { declinedAt: { lt: before } },
          { revokedAt: { lt: before } },
        ],
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
}
