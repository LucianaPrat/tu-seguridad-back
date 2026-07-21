import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { buildData } from '../../cross/errors/either';
import { validationExceptionFactory } from '../../cross/errors/validation-exception.factory';
import { PrismaService } from '../../data/prisma/prisma.service';
import { DetectPersonsResponse } from '../face-auth-client/detect-persons-response';
import { FaceAuthClientService } from '../face-auth-client/face-auth-client.service';

interface AnalyzeResponseBody {
  persons: unknown[];
  zoneResults: { zoneId: string; occupied: boolean }[];
  eventsEmitted: { eventType: string; zoneId: string }[];
}

interface CameraStatusBody {
  lastPersonsDetected: boolean | null;
  lastSuccessAt: string | null;
}

describe('Pipeline analyze (int)', () => {
  const cameraId = 'camera_pipeline_int';
  const zoneId = 'zone_pipeline_int';

  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let token: string;
  let baseUrl: string;
  let fakeDetectPersons: jest.Mock;

  beforeAll(async () => {
    fakeDetectPersons = jest.fn();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FaceAuthClientService)
      .useValue({ detectPersons: fakeDetectPersons })
      .compile();

    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Mirrors main.ts's bootstrap: global prefix/versioning/pipes aren't on
    // AppModule itself, so they must be replicated here for routes to match
    // what a real client hits (/api/v1/...).
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

    await app.init();
    await app.listen(0);

    httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;
    token = jwtService.sign({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneEvent.deleteMany();
    await prisma.zone.deleteMany();
    await prisma.camera.deleteMany();

    await prisma.camera.create({
      data: {
        id: cameraId,
        name: 'Pipeline Int Camera',
        snapshotUrl: 'http://example.com/snap.jpg',
        confidenceThreshold: 0.5,
      },
    });
    await prisma.zone.create({
      data: {
        id: zoneId,
        cameraId,
        name: 'Pipeline Int Zone',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        geometryVersion: 1,
      },
    });
  });

  function personInsideResponse(): DetectPersonsResponse {
    return {
      personsDetected: true,
      imageWidth: 100,
      imageHeight: 100,
      persons: [
        {
          detScore: 0.9,
          bbox: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 10, y: 10 } },
          bboxNorm: {
            topLeft: { x: 0, y: 0 },
            bottomRight: { x: 0.1, y: 0.1 },
          },
          anchor: { x: 0.5, y: 0.5 },
        },
      ],
    };
  }

  it('rejects analyze without a token', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/cameras/${cameraId}/analyze`)
      .attach('file', Buffer.from('x'), 'snapshot.jpg');

    expect(res.status).toBe(401);
  });

  it(
    'returns persons+zoneResults on every poll and emits+broadcasts a ' +
      'zone-event once hysteresis confirms entry',
    async () => {
      fakeDetectPersons.mockResolvedValue(buildData(personInsideResponse()));

      const client: ClientSocket = io(`${baseUrl}/events`, {
        auth: { token },
        reconnection: false,
        forceNew: true,
        transports: ['websocket'],
      });
      await new Promise<void>((resolve) =>
        client.on('connect', () => resolve()),
      );
      const zoneEventPromise = new Promise((resolve) => {
        client.once('zone-event', resolve);
      });

      const first = await request(httpServer)
        .post(`/api/v1/cameras/${cameraId}/analyze`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake-image-bytes'), 'snapshot.jpg');
      const firstBody = first.body as AnalyzeResponseBody;

      expect(first.status).toBe(201);
      expect(firstBody.persons).toHaveLength(1);
      expect(firstBody.zoneResults).toEqual([{ zoneId, occupied: true }]);
      expect(firstBody.eventsEmitted).toEqual([]);

      const second = await request(httpServer)
        .post(`/api/v1/cameras/${cameraId}/analyze`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake-image-bytes'), 'snapshot.jpg');
      const secondBody = second.body as AnalyzeResponseBody;

      expect(secondBody.eventsEmitted).toHaveLength(1);
      expect(secondBody.eventsEmitted[0]).toMatchObject({
        eventType: 'PERSON_ENTERED_ZONE',
        zoneId,
      });

      const receivedEvent = await zoneEventPromise;
      expect(receivedEvent).toMatchObject({
        eventType: 'PERSON_ENTERED_ZONE',
        zoneId,
      });

      const status = await request(httpServer)
        .get(`/api/v1/cameras/${cameraId}/status`)
        .set('Authorization', `Bearer ${token}`);
      const statusBody = status.body as CameraStatusBody;
      expect(statusBody.lastPersonsDetected).toBe(true);
      expect(statusBody.lastSuccessAt).not.toBeNull();

      client.close();
    },
    10000,
  );
});
