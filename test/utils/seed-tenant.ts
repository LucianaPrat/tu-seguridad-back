import { SpaceMemberRole } from '@prisma/client';
import {
  DEFAULT_MENU_ACCESS,
  MenuKey,
} from '../../src/cross/common/permissions';
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
    data: { name: spaceName, createdByUserId: user.id },
  });
  await prisma.spaceMember.create({
    data: {
      spaceId: space.id,
      userId: user.id,
      role: SpaceMemberRole.admin,
      menuAccess: DEFAULT_MENU_ACCESS.admin,
      cameraIds: [],
    },
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

export interface SeedMemberOptions {
  role?: SpaceMemberRole;
  menuAccess?: MenuKey[];
  cameraIds?: string[];
  receiveAlerts?: boolean;
}

/** A member of an existing space; a collaborator with the role defaults unless told otherwise. */
export async function seedMember(
  prisma: PrismaService,
  spaceId: string,
  email: string,
  options: SeedMemberOptions = {},
): Promise<SeededTenantUser> {
  const role = options.role ?? SpaceMemberRole.collaborator;
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
    data: {
      spaceId,
      userId: user.id,
      role,
      menuAccess: options.menuAccess ?? DEFAULT_MENU_ACCESS[role],
      cameraIds: options.cameraIds ?? [],
      ...(options.receiveAlerts === undefined
        ? {}
        : { receiveAlerts: options.receiveAlerts }),
    },
  });

  return { userId: user.id, email, password: E2E_PASSWORD, spaceId };
}

/**
 * A DVR row and `count` cameras (externalId '1'..'n', name 'Camera n'). No
 * recorder behind it: enough for scoping, not for capture or playback.
 */
export async function seedDvrWithCameras(
  prisma: PrismaService,
  spaceId: string,
  count: number,
): Promise<string[]> {
  const dvr = await prisma.dvr.create({
    data: {
      spaceId,
      url: 'http://192.168.1.10:8000',
      username: 'u',
      passwordEncrypted: 'x',
      timezone: 'UTC',
    },
  });
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const camera = await prisma.camera.create({
      data: { dvrId: dvr.id, externalId: String(n), name: `Camera ${n}` },
    });
    ids.push(camera.id);
  }
  return ids;
}
