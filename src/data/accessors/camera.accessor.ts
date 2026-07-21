import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Camera, Prisma } from '@prisma/client';
import { EnvNames } from '../../cross/common/constants';
import {
  decryptField,
  encryptField,
  looksEncrypted,
  normalizeEncryptionKey,
} from '../../cross/crypto/field-encryption';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CameraAccessorService {
  private cachedKey?: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(): Promise<Camera[]> {
    const cameras = await this.prisma.camera.findMany({
      orderBy: { id: 'asc' },
    });
    return cameras.map((camera) => this.decryptRow(camera));
  }

  async findById(id: string): Promise<Camera | null> {
    const camera = await this.prisma.camera.findUnique({ where: { id } });
    return camera ? this.decryptRow(camera) : null;
  }

  async create(data: Prisma.CameraCreateInput): Promise<Camera> {
    const camera = await this.prisma.camera.create({
      data: this.encryptSnapshotUrl(data),
    });
    return this.decryptRow(camera);
  }

  async update(id: string, data: Prisma.CameraUpdateInput): Promise<Camera> {
    const camera = await this.prisma.camera.update({
      where: { id },
      data: this.encryptSnapshotUrl(data),
    });
    return this.decryptRow(camera);
  }

  async delete(id: string): Promise<Camera> {
    const camera = await this.prisma.camera.delete({ where: { id } });
    return this.decryptRow(camera);
  }

  countZones(cameraId: string): Promise<number> {
    return this.prisma.zone.count({ where: { cameraId } });
  }

  private get key(): Buffer {
    if (!this.cachedKey) {
      this.cachedKey = normalizeEncryptionKey(
        this.configService.get<string>(EnvNames.SNAPSHOT_URL_ENCRYPTION_KEY)!,
      );
    }
    return this.cachedKey;
  }

  /** Encrypt an inbound plaintext snapshotUrl in place, leaving the rest. */
  private encryptSnapshotUrl<T extends { snapshotUrl?: unknown }>(data: T): T {
    if (typeof data.snapshotUrl !== 'string') {
      return data;
    }
    return { ...data, snapshotUrl: encryptField(data.snapshotUrl, this.key) };
  }

  /** Decrypt an outbound row's snapshotUrl; pass through legacy plaintext. */
  private decryptRow(camera: Camera): Camera {
    if (!looksEncrypted(camera.snapshotUrl)) {
      return camera;
    }
    return {
      ...camera,
      snapshotUrl: decryptField(camera.snapshotUrl, this.key),
    };
  }
}
