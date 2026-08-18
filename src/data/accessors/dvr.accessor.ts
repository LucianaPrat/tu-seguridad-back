import { Injectable } from '@nestjs/common';
import { Camera, CameraStatus, Dvr } from '@prisma/client';
import { FieldEncryptionService } from '../../cross/crypto/field-encryption.service';
import { PrismaService } from '../prisma/prisma.service';

export interface DvrConfiguration {
  url: string;
  username: string;
  password: string;
  timezone: string;
}

export interface DiscoveredCamera {
  externalId: string;
  name: string;
  location?: string | null;
  status?: CameraStatus;
}

export type DvrDetails = Omit<Dvr, 'passwordEncrypted'>;

export interface DvrCredentials extends DvrDetails {
  password: string;
}

@Injectable()
export class DvrAccessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  async upsertConfiguration(
    spaceId: string,
    configuration: DvrConfiguration,
  ): Promise<DvrDetails> {
    const { password, ...configurationFields } = configuration;
    const passwordEncrypted = this.fieldEncryption.encrypt(password);
    const dvr = await this.prisma.dvr.upsert({
      where: { spaceId },
      create: { spaceId, ...configurationFields, passwordEncrypted },
      update: { ...configurationFields, passwordEncrypted },
    });
    return this.toDetails(dvr);
  }

  async findBySpaceId(spaceId: string): Promise<DvrDetails | null> {
    const dvr = await this.prisma.dvr.findUnique({ where: { spaceId } });
    return dvr ? this.toDetails(dvr) : null;
  }

  async findCredentialsBySpaceId(
    spaceId: string,
  ): Promise<DvrCredentials | null> {
    const dvr = await this.prisma.dvr.findUnique({ where: { spaceId } });
    if (!dvr) {
      return null;
    }
    return {
      ...this.toDetails(dvr),
      password: this.fieldEncryption.decrypt(dvr.passwordEncrypted),
    };
  }

  /**
   * Records the outcome of the last connectivity probe. Separate from
   * `upsertConfiguration` on purpose: a probe against a stored configuration
   * must be able to mark it failing without rewriting the credentials.
   */
  async recordTestResult(
    spaceId: string,
    ok: boolean,
  ): Promise<DvrDetails | null> {
    const result = await this.prisma.dvr.updateMany({
      where: { spaceId },
      data: { lastTestAt: new Date(), lastTestOk: ok },
    });
    return result.count === 1 ? this.findBySpaceId(spaceId) : null;
  }

  /** Every space that owns a recorder — the poll scheduler's work list. */
  async findSpaceIdsWithDvr(): Promise<string[]> {
    const rows = await this.prisma.dvr.findMany({
      select: { spaceId: true },
      orderBy: { spaceId: 'asc' },
    });
    return rows.map((row) => row.spaceId);
  }

  async reconcileDiscovery(
    spaceId: string,
    discovered: DiscoveredCamera[],
  ): Promise<Camera[]> {
    return this.prisma.$transaction(async (transaction) => {
      const dvr = await transaction.dvr.findUnique({ where: { spaceId } });
      if (!dvr) {
        return [];
      }

      for (const camera of discovered) {
        await transaction.camera.upsert({
          where: {
            dvrId_externalId: {
              dvrId: dvr.id,
              externalId: camera.externalId,
            },
          },
          create: {
            dvrId: dvr.id,
            externalId: camera.externalId,
            name: camera.name,
            location: camera.location,
            status: camera.status ?? 'offline',
          },
          // Only the status is refreshed. `name` and `location` default to
          // what the recorder reports the first time a channel appears and
          // belong to the operator afterwards — re-running discovery must not
          // undo a rename.
          update: { status: camera.status ?? 'offline' },
        });
      }

      await transaction.camera.updateMany({
        where: {
          dvrId: dvr.id,
          deletedAt: null,
          externalId: { notIn: discovered.map((camera) => camera.externalId) },
        },
        data: { isConfigured: false },
      });

      return transaction.camera.findMany({
        where: { dvrId: dvr.id, deletedAt: null },
        orderBy: { externalId: 'asc' },
      });
    });
  }

  private toDetails({
    passwordEncrypted: _passwordEncrypted,
    ...dvr
  }: Dvr): DvrDetails {
    void _passwordEncrypted;
    return dvr;
  }
}
