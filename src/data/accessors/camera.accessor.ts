import { Injectable } from '@nestjs/common';
import { Camera, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CameraAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Camera[]> {
    return this.prisma.camera.findMany({ orderBy: { id: 'asc' } });
  }

  findById(id: string): Promise<Camera | null> {
    return this.prisma.camera.findUnique({ where: { id } });
  }

  create(data: Prisma.CameraCreateInput): Promise<Camera> {
    return this.prisma.camera.create({ data });
  }

  update(id: string, data: Prisma.CameraUpdateInput): Promise<Camera> {
    return this.prisma.camera.update({ where: { id }, data });
  }

  delete(id: string): Promise<Camera> {
    return this.prisma.camera.delete({ where: { id } });
  }

  countZones(cameraId: string): Promise<number> {
    return this.prisma.zone.count({ where: { cameraId } });
  }
}
