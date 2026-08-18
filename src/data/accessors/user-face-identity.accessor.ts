import { Injectable } from '@nestjs/common';
import { UserFaceIdentity } from '@prisma/client';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';

export type UserFaceIdentityRecord = Omit<UserFaceIdentity, 'tokenHash'>;

@Injectable()
export class UserFaceIdentityAccessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialHash: CredentialHashService,
  ) {}

  async register(
    userId: number,
    token: string,
  ): Promise<UserFaceIdentityRecord> {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      await transaction.userFaceIdentity.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, revokedAt: now },
      });
      const identity = await transaction.userFaceIdentity.create({
        data: {
          userId,
          tokenHash: this.credentialHash.hashFaceIdentity(token),
        },
      });
      return this.withoutHash(identity);
    });
  }

  async findActiveByToken(
    token: string,
  ): Promise<UserFaceIdentityRecord | null> {
    const identity = await this.prisma.userFaceIdentity.findFirst({
      where: {
        tokenHash: this.credentialHash.hashFaceIdentity(token),
        isActive: true,
        revokedAt: null,
      },
    });
    return identity ? this.withoutHash(identity) : null;
  }

  async recordUse(token: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.userFaceIdentity.updateMany({
      where: {
        tokenHash: this.credentialHash.hashFaceIdentity(token),
        isActive: true,
        revokedAt: null,
      },
      data: { lastUsedAt: now },
    });
    return result.count === 1;
  }

  private withoutHash({
    tokenHash: _tokenHash,
    ...identity
  }: UserFaceIdentity): UserFaceIdentityRecord {
    void _tokenHash;
    return identity;
  }
}
