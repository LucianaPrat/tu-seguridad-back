import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module';
import { ALERT_ROUTING_DEFAULTS } from '../../src/cross/common/constants';
import { setupSwagger } from '../../src/cross/config/swagger.config';
import { buildData, Either } from '../../src/cross/errors/either';
import { validationExceptionFactory } from '../../src/cross/errors/validation-exception.factory';
import { PrismaService } from '../../src/data/prisma/prisma.service';
import { DetectPersonsResponse } from '../../src/modules/face-auth-client/detect-persons-response';
import { FaceAuthClientService } from '../../src/modules/face-auth-client/face-auth-client.service';

const BCRYPT_COST = 10;

export class FakeFaceAuthClientService {
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
}

/**
 * Boots the real AppModule end-to-end (HTTP + WebSocket + the test
 * database), with FaceAuthClientService replaced by a fake. Mirrors
 * main.ts's bootstrap - global prefix/versioning/pipes live on the
 * INestApplication instance, not on AppModule itself, so they don't come
 * along for free from Test.createTestingModule.
 */
export async function bootstrapE2eApp(): Promise<E2eContext> {
  const fakeFaceAuthClient = new FakeFaceAuthClientService();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FaceAuthClientService)
    .useValue(fakeFaceAuthClient)
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
