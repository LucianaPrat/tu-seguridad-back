import { PrismaService } from '../../src/data/prisma/prisma.service';

/** Deletes every row across all app tables, respecting FK order. */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.eventDelivery.deleteMany();
  await prisma.alertEvent.deleteMany();
  await prisma.snapshot.deleteMany();
  await prisma.monitorZone.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.dvr.deleteMany();
  await prisma.alertRouting.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.userFaceIdentity.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.hit.deleteMany();
  await prisma.user.deleteMany();
}
