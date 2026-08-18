import { Injectable } from '@nestjs/common';
import { Invitation } from '@prisma/client';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInvitationInput {
  spaceId: string;
  email: string;
  token: string;
  invitedByUserId: number;
  expiresAt: Date;
}

export type InvitationRecord = Omit<Invitation, 'tokenHash'>;

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

  private withoutHash({
    tokenHash: _tokenHash,
    ...invitation
  }: Invitation): InvitationRecord {
    void _tokenHash;
    return invitation;
  }
}
