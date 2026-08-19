import { SpaceMemberRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ALERT_ROUTING_DEFAULTS } from '../../src/cross/common/constants';
import { PrismaService } from '../../src/data/prisma/prisma.service';

const BCRYPT_COST = 10;

export const E2E_PASSWORD = 'e2e-password-1234';

export interface SeededTenantUser {
  userId: number;
  email: string;
  password: string;
  spaceId: string;
}

/**
 * A second, fully-formed tenant: account, space, owner membership and routing
 * defaults. Cross-space tests need a real graph on the other side — a bare user
 * would fail at login instead of at the isolation assertion under test.
 */
export async function seedTenant(
  prisma: PrismaService,
  email: string,
  spaceName: string,
): Promise<SeededTenantUser> {
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Other',
      lastName: 'Owner',
      phone: '+10000000001',
      isActive: true,
      profileCompleted: true,
    },
  });
  const space = await prisma.space.create({
    data: { name: spaceName, ownerUserId: user.id },
  });
  await prisma.spaceMember.create({
    data: { spaceId: space.id, userId: user.id, role: SpaceMemberRole.admin },
  });
  await prisma.alertRouting.createMany({
    data: ALERT_ROUTING_DEFAULTS.map((routing) => ({
      spaceId: space.id,
      ...routing,
    })),
    skipDuplicates: true,
  });

  return {
    userId: user.id,
    email,
    password: E2E_PASSWORD,
    spaceId: space.id,
  };
}

/** A plain member of an existing space — the role-authorization counterexample. */
export async function seedMember(
  prisma: PrismaService,
  spaceId: string,
  email: string,
): Promise<SeededTenantUser> {
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Space',
      lastName: 'Member',
      phone: '+10000000002',
      isActive: true,
      profileCompleted: true,
    },
  });
  await prisma.spaceMember.create({
    data: { spaceId, userId: user.id, role: SpaceMemberRole.member },
  });

  return { userId: user.id, email, password: E2E_PASSWORD, spaceId };
}
