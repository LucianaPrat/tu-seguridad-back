import { Injectable } from '@nestjs/common';
import { Camera, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { ZoneAccessorService } from '../../data/accessors/zone.accessor';
import { Either, buildData } from '../../cross/errors/either';
import { EventsService } from '../events/events.service';
import { ZoneEventDto } from '../events/dto/zone-event.dto';
import { FaceAuthClientService } from '../face-auth-client/face-auth-client.service';
import { Point, pointInPolygon } from '../zones/geometry';
import { AnalysisResult, ZoneResult } from './analysis-result';
import {
  AnchorWithScore,
  OccupancyEngine,
  ZoneInput,
} from './occupancy.engine';

@Injectable()
export class PipelineService {
  constructor(
    private readonly faceAuthClient: FaceAuthClientService,
    private readonly zoneAccessor: ZoneAccessorService,
    private readonly eventsService: EventsService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly occupancyEngine: OccupancyEngine,
  ) {}

  async processImage(
    camera: Camera,
    image: Buffer,
  ): Promise<Either<AnalysisResult>> {
    const startedAt = Date.now();
    this.statusRegistry.record(camera.id, { lastPolledAt: new Date() });

    const detection = await this.faceAuthClient.detectPersons(
      image,
      `${camera.id}.jpg`,
    );
    if (!detection.ok) {
      this.statusRegistry.record(camera.id, {
        lastErrorAt: new Date(),
        lastErrorCode: detection.code,
      });
      return detection;
    }

    const persons = detection.data.persons.filter(
      (p) => p.detScore >= camera.confidenceThreshold,
    );

    const zones = await this.zoneAccessor.findByCamera(camera.id);
    const zoneInputs: ZoneInput[] = zones.map((zone) => ({
      zoneId: zone.id,
      enabled: zone.enabled,
      polygon: zone.polygon as unknown as Point[],
    }));
    const enabledZoneInputs = zoneInputs.filter((zone) => zone.enabled);

    const anchors: AnchorWithScore[] = persons.map((p) => ({
      anchor: p.anchor,
      detScore: p.detScore,
    }));

    const transitions = this.occupancyEngine.evaluate(
      camera.id,
      enabledZoneInputs,
      anchors,
    );

    const eventsEmitted: ZoneEventDto[] = [];
    for (const transition of transitions) {
      const eventDto = await this.eventsService.emit({
        eventId: randomUUID(),
        eventType: transition.eventType,
        cameraId: camera.id,
        zoneId: transition.zoneId,
        occurredAt: new Date(),
        confidence: transition.confidence,
        personsInZone: transition.personsInZone,
        anchor:
          (transition.anchor as unknown as Prisma.InputJsonValue) ?? undefined,
      });
      eventsEmitted.push(eventDto);
    }

    const zoneResults: ZoneResult[] = enabledZoneInputs.map((zone) => ({
      zoneId: zone.zoneId,
      occupied: anchors.some((a) => pointInPolygon(a.anchor, zone.polygon)),
    }));

    this.statusRegistry.record(camera.id, {
      lastSuccessAt: new Date(),
      lastLatencyMs: Date.now() - startedAt,
      lastPersonsDetected: persons.length > 0,
      zones: zoneResults,
    });

    return buildData({ persons, zoneResults, eventsEmitted });
  }
}
