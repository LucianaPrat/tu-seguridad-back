import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { register as promRegister } from 'prom-client';
import { createHash } from 'node:crypto';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module';
import {
  ALERT_ROUTING_DEFAULTS,
  ErrorCode,
} from '../../src/cross/common/constants';
import { setupSwagger } from '../../src/cross/config/swagger.config';
import { buildData, buildError, Either } from '../../src/cross/errors/either';
import { validationExceptionFactory } from '../../src/cross/errors/validation-exception.factory';
import { PrismaService } from '../../src/data/prisma/prisma.service';
import {
  CredentialDelivery,
  CredentialDeliveryPort,
  DeliveredCredentialPurpose,
} from '../../src/modules/auth/credential-delivery.port';
import {
  CapturedImage,
  DiscoveredChannel,
  DvrClientPort,
  DvrConnection,
} from '../../src/modules/dvr/dvr-client.port';
import { DetectPersonsResponse } from '../../src/modules/face-auth-client/detect-persons-response';
import { FaceAuthClientService } from '../../src/modules/face-auth-client/face-auth-client.service';
import {
  LiveStream,
  StreamPublisherPort,
} from '../../src/modules/streaming/stream-publisher.port';

const BCRYPT_COST = 10;

/**
 * Structurally unchecked before: a rename on the real client left every e2e
 * spec green against a stand-in that no longer matched it.
 */
export class FakeFaceAuthClientService implements Pick<
  FaceAuthClientService,
  'detectPersons'
> {
  response: DetectPersonsResponse = {
    personsDetected: false,
    imageWidth: 100,
    imageHeight: 100,
    persons: [],
  };

  detectPersons(): Promise<Either<DetectPersonsResponse>> {
    return Promise.resolve(buildData(this.response));
  }
}

/**
 * Stands in for a real recorder. Tests set `channels` and `image`, or flip
 * `reachable` to false to rehearse an unreachable DVR — the e2e suite must be
 * able to run the whole tenant flow with no appliance on the network.
 */
export class FakeDvrClientService extends DvrClientPort {
  channels: DiscoveredChannel[] = [];
  image: Buffer = Buffer.from('fake-snapshot-bytes');
  mimeType = 'image/jpeg';
  reachable = true;

  discoverChannels(): Promise<Either<DiscoveredChannel[]>> {
    if (!this.reachable) {
      return Promise.resolve(
        buildError(ErrorCode.UPSTREAM_ERROR, 'DVR channel discovery failed'),
      );
    }
    return Promise.resolve(buildData(this.channels));
  }

  captureSnapshot(): Promise<Either<CapturedImage>> {
    if (!this.reachable) {
      return Promise.resolve(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR snapshot fetch timed out'),
      );
    }
    return Promise.resolve(
      buildData({
        data: this.image,
        mimeType: this.mimeType,
        byteSize: this.image.byteLength,
        sha256: createHash('sha256').update(this.image).digest('hex'),
        capturedAt: new Date(),
      }),
    );
  }

  // Reachability does not apply: the real one builds a string and issues no
  // request, so a recorder being down cannot change its answer.
  streamUrl(connection: DvrConnection, externalId: string): Either<string> {
    return buildData(
      `rtsp://fake/${encodeURIComponent(connection.username)}/${externalId}`,
    );
  }
}

/**
 * Stands in for the media server. Records what it was asked to publish so a
 * spec can assert the recorder password never reached a response, and keeps the
 * e2e suite free of a MediaMTX on the network.
 */
export class FakeStreamPublisherService extends StreamPublisherPort {
  published: { pathName: string; sourceUrl: string }[] = [];
  reachable = true;

  publish(pathName: string, sourceUrl: string): Promise<Either<LiveStream>> {
    if (!this.reachable) {
      return Promise.resolve(
        buildError(ErrorCode.UPSTREAM_ERROR, 'Stream publish failed'),
      );
    }
    this.published.push({ pathName, sourceUrl });
    return Promise.resolve(
      buildData({
        protocol: 'hls' as const,
        url: `http://media.fake/${pathName}/index.m3u8`,
      }),
    );
  }
}

/**
 * Stands in for the real mail/SMS provider. The raw credential never reaches
 * any response body — this is the only way an e2e test can get at it — so
 * tests read it off `deliveries`, or the `lastTokenFor` helper.
 */
export class FakeCredentialDeliveryService extends CredentialDeliveryPort {
  deliveries: CredentialDelivery[] = [];

  deliver(delivery: CredentialDelivery): Promise<void> {
    this.deliveries.push(delivery);
    return Promise.resolve();
  }

  lastTokenFor(purpose: DeliveredCredentialPurpose): string {
    const match = this.deliveries.findLast(
      (delivery) => delivery.purpose === purpose,
    );
    if (!match) {
      throw new Error(`no credential delivered for purpose "${purpose}"`);
    }
    return match.token;
  }
}

export interface SeededAdmin {
  userId: number;
  email: string;
  spaceId: string;
  spaceName: string;
}

export interface E2eContext {
  app: INestApplication;
  httpServer: Server;
  baseUrl: string;
  prisma: PrismaService;
  jwtService: JwtService;
  fakeFaceAuthClient: FakeFaceAuthClientService;
  fakeDvrClient: FakeDvrClientService;
  fakeCredentialDelivery: FakeCredentialDeliveryService;
  fakeStreamPublisher: FakeStreamPublisherService;
}

/**
 * Boots the real AppModule end-to-end (HTTP + WebSocket + the test
 * database), with FaceAuthClientService replaced by a fake. Mirrors
 * main.ts's bootstrap - global prefix/versioning/pipes live on the
 * INestApplication instance, not on AppModule itself, so they don't come
 * along for free from Test.createTestingModule.
 */
export async function bootstrapE2eApp(): Promise<E2eContext> {
  // prom-client's default registry is module state, and registering the same
  // metric twice throws. Jest gives each spec file its own module registry, so
  // this only bites a file that boots the app more than once - which is cheap
  // to make impossible rather than to remember.
  promRegister.clear();

  const fakeFaceAuthClient = new FakeFaceAuthClientService();
  const fakeDvrClient = new FakeDvrClientService();
  const fakeCredentialDelivery = new FakeCredentialDeliveryService();
  const fakeStreamPublisher = new FakeStreamPublisherService();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FaceAuthClientService)
    .useValue(fakeFaceAuthClient)
    .overrideProvider(DvrClientPort)
    .useValue(fakeDvrClient)
    .overrideProvider(CredentialDeliveryPort)
    .useValue(fakeCredentialDelivery)
    .overrideProvider(StreamPublisherPort)
    .useValue(fakeStreamPublisher)
    .compile();

  const app = moduleRef.createNestApplication();

  // The refresh route reads its token off req.cookies, so the parser is not
  // optional here the way the other main.ts middleware is.
  app.use(cookieParser());
  app.setGlobalPrefix('api', { exclude: ['docs', 'health/(.*)'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  setupSwagger(app);

  await app.init();
  await app.listen(0);

  const httpServer = app.getHttpServer() as Server;
  const address = httpServer.address() as AddressInfo;
  const prisma = app.get(PrismaService);

  await ensureAdminSeeded(prisma);

  return {
    app,
    httpServer,
    baseUrl: `http://localhost:${address.port}`,
    prisma,
    jwtService: app.get(JwtService),
    fakeFaceAuthClient,
    fakeDvrClient,
    fakeCredentialDelivery,
    fakeStreamPublisher,
  };
}

/**
 * Upserts the seeded admin directly (mirrors prisma/seed.ts) so the e2e
 * suite doesn't depend on `npm run prisma:seed` having been run against
 * DATABASE_URL_TEST beforehand.
 *
 * It builds the whole tenant graph — account, space, owner membership, routing
 * defaults — because a user without an accepted membership is exactly what the
 * login gate rejects, and a fixture that inserted a bare user would fail at
 * login rather than at the assertion under test.
 */
export async function ensureAdminSeeded(
  prisma: PrismaService,
): Promise<SeededAdmin> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'change-me';
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const profile = {
    passwordHash,
    firstName: 'Admin',
    lastName: 'User',
    phone: '+10000000000',
    isActive: true,
    profileCompleted: true,
  };

  const user = await prisma.user.upsert({
    where: { email },
    update: profile,
    create: { email, ...profile },
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
    data: ALERT_ROUTING_DEFAULTS.map((routing) => ({
      spaceId: space.id,
      ...routing,
    })),
    skipDuplicates: true,
  });

  return { userId: user.id, email, spaceId: space.id, spaceName: space.name };
}
