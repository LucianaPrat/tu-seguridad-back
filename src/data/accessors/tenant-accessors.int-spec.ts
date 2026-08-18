import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnvNames } from '../../cross/common/constants';
import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { FieldEncryptionService } from '../../cross/crypto/field-encryption.service';
import { AlertEventAccessorService } from './alert-event.accessor';
import { AuthTokenAccessorService } from './auth-token.accessor';
import { CameraAccessorService } from './camera.accessor';
import { DvrAccessorService } from './dvr.accessor';
import { InvitationAccessorService } from './invitation.accessor';
import { SnapshotAccessorService } from './snapshot.accessor';
import { UserFaceIdentityAccessorService } from './user-face-identity.accessor';
import { MonitorZoneAccessorService } from './zone.accessor';
import { truncateAll } from '../../../test/utils/truncate-all';

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('tenant-scoped accessors (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const config = new ConfigService({
    [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]: ENCRYPTION_KEY,
  });
  const credentialHash = new CredentialHashService();
  const dvrAccessor = new DvrAccessorService(
    prisma,
    new FieldEncryptionService(config),
  );
  const cameraAccessor = new CameraAccessorService(prisma);
  const zoneAccessor = new MonitorZoneAccessorService(prisma);
  const snapshotAccessor = new SnapshotAccessorService(prisma);
  const authTokenAccessor = new AuthTokenAccessorService(
    prisma,
    credentialHash,
  );
  const invitationAccessor = new InvitationAccessorService(
    prisma,
    credentialHash,
  );
  const faceIdentityAccessor = new UserFaceIdentityAccessorService(
    prisma,
    credentialHash,
  );
  const alertEventAccessor = new AlertEventAccessorService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function createTenant(name: string) {
    const user = await prisma.user.create({
      data: {
        email: `${name}@example.com`,
        passwordHash: 'bcrypt-hash',
        firstName: name,
        lastName: 'User',
        phone: '+10000000000',
      },
    });
    const space = await prisma.space.create({
      data: { name: `${name} space`, ownerUserId: user.id },
    });
    await prisma.spaceMember.create({
      data: { spaceId: space.id, userId: user.id, role: 'admin' },
    });
    const dvr = await dvrAccessor.upsertConfiguration(space.id, {
      url: `http://${name}.local`,
      username: `${name}-dvr`,
      password: `${name}-password`,
      timezone: 'UTC',
    });
    const camera = await cameraAccessor.create(space.id, {
      dvrId: dvr.id,
      externalId: `${name}-channel-1`,
      name: `${name} camera`,
      isConfigured: true,
    });
    if (!camera) {
      throw new Error('tenant camera creation unexpectedly failed');
    }
    return { user, space, dvr, camera };
  }

  it('does not find, update, delete, or read a Space B resource through Space A', async () => {
    const tenantA = await createTenant('alpha');
    const tenantB = await createTenant('bravo');
    const snapshot = await snapshotAccessor.create(tenantB.space.id, {
      cameraId: tenantB.camera.id,
      data: Buffer.from('image-b'),
      mimeType: 'image/jpeg',
      byteSize: 7,
      sha256: 'b'.repeat(64),
      capturedAt: new Date(),
    });
    if (!snapshot) {
      throw new Error('snapshot creation unexpectedly failed');
    }

    await expect(
      cameraAccessor.findById(tenantA.space.id, tenantB.camera.id),
    ).resolves.toBeNull();
    await expect(
      cameraAccessor.update(tenantA.space.id, tenantB.camera.id, {
        name: 'stolen name',
      }),
    ).resolves.toBeNull();
    await expect(
      cameraAccessor.softDelete(tenantA.space.id, tenantB.camera.id),
    ).resolves.toBe(false);
    await expect(
      snapshotAccessor.findById(tenantA.space.id, snapshot.id),
    ).resolves.toBeNull();
    await expect(
      snapshotAccessor.findById(tenantB.space.id, snapshot.id),
    ).resolves.toMatchObject({ id: snapshot.id });
  });

  it('hides logical deletes from normal reads while retaining historical snapshots', async () => {
    const tenant = await createTenant('soft-delete');
    const zone = await zoneAccessor.create(tenant.space.id, {
      cameraId: tenant.camera.id,
      x: '0',
      y: '0',
      width: '100',
      height: '100',
      alertType: 'intruder',
    });
    const snapshot = await snapshotAccessor.create(tenant.space.id, {
      cameraId: tenant.camera.id,
      data: Buffer.from('image-history'),
      mimeType: 'image/jpeg',
      byteSize: 13,
      sha256: 'a'.repeat(64),
      capturedAt: new Date(),
    });
    if (!zone || !snapshot) {
      throw new Error('fixture creation unexpectedly failed');
    }

    expect(await zoneAccessor.softDelete(tenant.space.id, zone.id)).toBe(true);
    expect(await zoneAccessor.findById(tenant.space.id, zone.id)).toBeNull();
    expect(
      await cameraAccessor.softDelete(tenant.space.id, tenant.camera.id),
    ).toBe(true);
    expect(
      await cameraAccessor.findById(tenant.space.id, tenant.camera.id),
    ).toBeNull();
    expect(await cameraAccessor.findPollableBySpace(tenant.space.id)).toEqual(
      [],
    );
    expect(
      await snapshotAccessor.findById(tenant.space.id, snapshot.id),
    ).toMatchObject({
      id: snapshot.id,
    });
  });

  it('retains discovered configuration, marks missing channels unconfigured, and never revives a deleted camera', async () => {
    const tenant = await createTenant('discovery');
    const configured = await cameraAccessor.update(
      tenant.space.id,
      tenant.camera.id,
      {
        isConfigured: true,
        monitorMode: 'partial',
        alertType: 'suspicious',
      },
    );
    if (!configured) {
      throw new Error('camera configuration unexpectedly failed');
    }

    const reconciled = await dvrAccessor.reconcileDiscovery(tenant.space.id, [
      {
        externalId: tenant.camera.externalId,
        name: 'Renamed discovered camera',
        status: 'online',
      },
      { externalId: 'new-channel', name: 'New camera' },
    ]);
    const retained = reconciled.find(
      (camera) => camera.id === tenant.camera.id,
    );
    expect(retained).toMatchObject({
      name: 'Renamed discovered camera',
      monitorMode: 'partial',
      alertType: 'suspicious',
      isConfigured: true,
    });

    const afterMissing = await dvrAccessor.reconcileDiscovery(tenant.space.id, [
      {
        externalId: tenant.camera.externalId,
        name: 'Renamed discovered camera',
      },
    ]);
    expect(
      afterMissing.find((camera) => camera.externalId === 'new-channel'),
    ).toMatchObject({
      isConfigured: false,
    });

    expect(
      await cameraAccessor.softDelete(tenant.space.id, tenant.camera.id),
    ).toBe(true);
    await dvrAccessor.reconcileDiscovery(tenant.space.id, [
      { externalId: tenant.camera.externalId, name: 'Attempted restore' },
    ]);
    const deleted = await prisma.camera.findUnique({
      where: {
        dvrId_externalId: {
          dvrId: tenant.dvr.id,
          externalId: tenant.camera.externalId,
        },
      },
    });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(
      await cameraAccessor.findById(tenant.space.id, tenant.camera.id),
    ).toBeNull();
  });

  it('encrypts DVR passwords and hashes tokens and invitation values before storage', async () => {
    const tenant = await createTenant('credentials');
    const credentials = await dvrAccessor.findCredentialsBySpaceId(
      tenant.space.id,
    );
    expect(credentials?.password).toBe('credentials-password');
    const storedDvr = await prisma.dvr.findUnique({
      where: { id: tenant.dvr.id },
    });
    expect(storedDvr?.passwordEncrypted).not.toContain('credentials-password');

    const refreshToken = 'raw-refresh-token';
    await authTokenAccessor.create({
      userId: tenant.user.id,
      purpose: 'refresh',
      token: refreshToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await authTokenAccessor.findUsableByToken('refresh', refreshToken),
    ).toMatchObject({ userId: tenant.user.id });
    expect(await authTokenAccessor.revoke('refresh', refreshToken)).toBe(true);
    expect(
      await authTokenAccessor.findUsableByToken('refresh', refreshToken),
    ).toBeNull();
    const storedToken = await prisma.authToken.findFirst({
      where: { userId: tenant.user.id },
    });
    expect(storedToken?.tokenHash).not.toBe(refreshToken);

    const invitationToken = 'raw-invitation-token';
    const invitation = await invitationAccessor.create({
      spaceId: tenant.space.id,
      email: 'invitee@example.com',
      token: invitationToken,
      invitedByUserId: tenant.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await invitationAccessor.findUsableByToken(invitationToken),
    ).toMatchObject({
      id: invitation.id,
    });
    expect(
      await invitationAccessor.consume(invitationToken, tenant.user.id),
    ).toBe(true);
    expect(
      await invitationAccessor.findUsableByToken(invitationToken),
    ).toBeNull();

    const consumableToken = 'raw-password-reset-token';
    await authTokenAccessor.create({
      userId: tenant.user.id,
      purpose: 'password_reset',
      token: consumableToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await authTokenAccessor.consume('password_reset', consumableToken),
    ).toBe(true);
    expect(
      await authTokenAccessor.findUsableByToken(
        'password_reset',
        consumableToken,
      ),
    ).toBeNull();

    const rotatingToken = 'raw-rotating-refresh-token';
    await authTokenAccessor.create({
      userId: tenant.user.id,
      purpose: 'refresh',
      token: rotatingToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rotated = await authTokenAccessor.rotateRefresh(rotatingToken, {
      userId: tenant.user.id,
      token: 'raw-rotated-refresh-token',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(rotated?.rotatedFromId).toBeDefined();
    expect(
      await authTokenAccessor.findUsableByToken('refresh', rotatingToken),
    ).toBeNull();

    const firstIdentity = await faceIdentityAccessor.register(
      tenant.user.id,
      'raw-face-token-a',
    );
    const secondIdentity = await faceIdentityAccessor.register(
      tenant.user.id,
      'raw-face-token-b',
    );
    expect(
      await faceIdentityAccessor.findActiveByToken('raw-face-token-a'),
    ).toBeNull();
    expect(
      await faceIdentityAccessor.findActiveByToken('raw-face-token-b'),
    ).toMatchObject({
      id: secondIdentity.id,
    });
    const revokedIdentity = await prisma.userFaceIdentity.findUnique({
      where: { id: firstIdentity.id },
    });
    expect(revokedIdentity?.isActive).toBe(false);
  });

  it('scopes alert event writes to the event space', async () => {
    const tenantA = await createTenant('events-alpha');
    const tenantB = await createTenant('events-bravo');
    await expect(
      alertEventAccessor.create(tenantA.space.id, {
        cameraId: tenantB.camera.id,
        cameraLabelSnapshot: tenantB.camera.name,
        alertType: 'intruder',
        detectedAt: new Date(),
      }),
    ).resolves.toBeNull();
  });
});
