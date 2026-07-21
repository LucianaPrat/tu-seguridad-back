import { PrismaService } from '../../src/data/prisma/prisma.service';

/** Deletes every row across all app tables, respecting FK order. */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.zoneEvent.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.hit.deleteMany();
  await prisma.user.deleteMany();
}
