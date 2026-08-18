import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_COST = 10;

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'change-me';
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      phone: '+10000000000',
      isActive: true,
      profileCompleted: true,
    },
    create: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      phone: '+10000000000',
      isActive: true,
      profileCompleted: true,
    },
  });

  const space = await prisma.space.upsert({
    where: { ownerUserId: user.id },
    update: {},
    create: { name: 'My Secure Space', ownerUserId: user.id },
  });

  await prisma.spaceMember.upsert({
    where: { userId: user.id },
    update: { role: 'admin', receiveAlerts: true },
    create: {
      spaceId: space.id,
      userId: user.id,
      role: 'admin',
      receiveAlerts: true,
    },
  });

  await prisma.alertRouting.createMany({
    data: [
      { spaceId: space.id, alertType: 'intruder', channel: 'call' },
      { spaceId: space.id, alertType: 'intruder', channel: 'whatsapp' },
      { spaceId: space.id, alertType: 'intruder', channel: 'email' },
      { spaceId: space.id, alertType: 'suspicious', channel: 'call' },
      { spaceId: space.id, alertType: 'suspicious', channel: 'whatsapp' },
      { spaceId: space.id, alertType: 'suspicious', channel: 'email' },
    ],
    skipDuplicates: true,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
