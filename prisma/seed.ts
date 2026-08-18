import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
// Shared with registration, which provisions a space the same way: two copies of
// the default routing matrix would let a seeded space and a registered one differ.
import { ALERT_ROUTING_DEFAULTS } from '../src/cross/common/constants';

const BCRYPT_COST = 10;

const prisma = new PrismaClient();

async function main() {
  // Email uniqueness is global and the column is compared case-insensitively; normalize on the
  // way in so the seeded admin matches whatever casing a later login sends.
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'change-me';
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // One transaction: a user without its space and owner membership is exactly the state the
  // login gate rejects, and the seed is documented as idempotent.
  await prisma.$transaction(async (tx) => {
    const profile = {
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      phone: '+10000000000',
      isActive: true,
      profileCompleted: true,
    };

    const user = await tx.user.upsert({
      where: { email },
      update: profile,
      create: { email, ...profile },
    });

    const space = await tx.space.upsert({
      where: { ownerUserId: user.id },
      update: {},
      create: { name: 'My Secure Space', ownerUserId: user.id },
    });

    await tx.spaceMember.upsert({
      where: { userId: user.id },
      update: { role: 'admin', receiveAlerts: true },
      create: {
        spaceId: space.id,
        userId: user.id,
        role: 'admin',
        receiveAlerts: true,
      },
    });

    // skipDuplicates, not upsert: re-seeding must never stomp a matrix the operator has toggled.
    await tx.alertRouting.createMany({
      data: ALERT_ROUTING_DEFAULTS.map((routing) => ({
        spaceId: space.id,
        ...routing,
      })),
      skipDuplicates: true,
    });
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
