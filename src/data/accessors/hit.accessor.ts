import { Injectable } from '@nestjs/common';
import { Hit, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HitAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.HitCreateInput): Promise<Hit> {
    return this.prisma.hit.create({ data });
  }
}
