import { Injectable } from '@nestjs/common';
import { AuthToken, AuthTokenPurpose } from '@prisma/client';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAuthTokenInput {
  userId: number;
  purpose: AuthTokenPurpose;
  token: string;
  expiresAt: Date;
  rotatedFromId?: string;
  userAgent?: string;
  ip?: string;
}

export type AuthTokenRecord = Omit<AuthToken, 'tokenHash'>;

@Injectable()
export class AuthTokenAccessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialHash: CredentialHashService,
  ) {}

  async create(input: CreateAuthTokenInput): Promise<AuthTokenRecord> {
    const token = await this.prisma.authToken.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: this.credentialHash.hashAuthToken(
          input.purpose,
          input.token,
        ),
        expiresAt: input.expiresAt,
        rotatedFromId: input.rotatedFromId,
        userAgent: input.userAgent,
        ip: input.ip,
      },
    });
    return this.withoutHash(token);
  }

  async findUsableByToken(
    purpose: AuthTokenPurpose,
    token: string,
    now = new Date(),
  ): Promise<AuthTokenRecord | null> {
    const authToken = await this.prisma.authToken.findFirst({
      where: {
        purpose,
        tokenHash: this.credentialHash.hashAuthToken(purpose, token),
        expiresAt: { gt: now },
        usedAt: null,
        revokedAt: null,
      },
    });
    return authToken ? this.withoutHash(authToken) : null;
  }

  async consume(
    purpose: AuthTokenPurpose,
    token: string,
    now = new Date(),
  ): Promise<boolean> {
    const result = await this.prisma.authToken.updateMany({
      where: {
        purpose,
        tokenHash: this.credentialHash.hashAuthToken(purpose, token),
        expiresAt: { gt: now },
        usedAt: null,
        revokedAt: null,
      },
      data: { usedAt: now },
    });
    return result.count === 1;
  }

  async revoke(
    purpose: AuthTokenPurpose,
    token: string,
    now = new Date(),
  ): Promise<boolean> {
    const result = await this.prisma.authToken.updateMany({
      where: {
        purpose,
        tokenHash: this.credentialHash.hashAuthToken(purpose, token),
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    return result.count === 1;
  }

  async rotateRefresh(
    token: string,
    successor: Omit<CreateAuthTokenInput, 'purpose' | 'token'> & {
      token: string;
    },
    now = new Date(),
  ): Promise<AuthTokenRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.authToken.findFirst({
        where: {
          purpose: 'refresh',
          tokenHash: this.credentialHash.hashAuthToken('refresh', token),
          expiresAt: { gt: now },
          usedAt: null,
          revokedAt: null,
        },
      });
      if (!current || current.userId !== successor.userId) {
        return null;
      }

      const revoked = await transaction.authToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        return null;
      }

      const { token: successorToken, ...successorFields } = successor;
      const rotated = await transaction.authToken.create({
        data: {
          ...successorFields,
          purpose: 'refresh',
          tokenHash: this.credentialHash.hashAuthToken(
            'refresh',
            successorToken,
          ),
          rotatedFromId: current.id,
        },
      });
      return this.withoutHash(rotated);
    });
  }

  private withoutHash({
    tokenHash: _tokenHash,
    ...authToken
  }: AuthToken): AuthTokenRecord {
    void _tokenHash;
    return authToken;
  }
}
