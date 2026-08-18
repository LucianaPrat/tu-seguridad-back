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
          update: {
            name: camera.name,
            location: camera.location,
            status: camera.status ?? 'offline',
          },
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
