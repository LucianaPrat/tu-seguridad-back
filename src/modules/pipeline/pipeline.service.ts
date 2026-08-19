import { Injectable } from '@nestjs/common';
import { Camera, MonitorMode } from '@prisma/client';
import { ErrorCode, PipelineDefaults } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { MonitorZoneAccessorService } from '../../data/accessors/zone.accessor';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { toCameraLabel } from '../cameras/camera.mapper';
import { CapturedImage } from '../dvr/dvr-client.port';
import { AlertEventsService } from '../events/alert-events.service';
import { FaceAuthClientService } from '../face-auth-client/face-auth-client.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { toRectangle } from '../zones/zone.mapper';
import { containsPoint, FULL_FRAME, toPercentPoint } from '../zones/rectangle';
import { AlertCandidate } from './alert-candidate';
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
    private readonly zoneAccessor: MonitorZoneAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly occupancyEngine: OccupancyEngine,
    private readonly alertEvents: AlertEventsService,
  ) {}

  resetOccupancy(cameraId: string): void {
    this.occupancyEngine.reset(cameraId);
  }

  /**
   * One detection pass over one frame. Callers hand in an already-captured
   * image so the same code serves the poll transport and the manual upload.
   */
  async processImage(
    spaceId: string,
    camera: Camera,
    image: CapturedImage,
  ): Promise<Either<AnalysisResult>> {
    const unusable = this.rejectUnusableCamera<AnalysisResult>(camera);
    if (unusable) {
      return unusable;
    }

    const startedAt = Date.now();
    this.statusRegistry.record(camera.id, { lastPolledAt: new Date() });

    const detection = await this.faceAuthClient.detectPersons(
      image.data,
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
      (person) => person.detScore >= PipelineDefaults.CONFIDENCE_THRESHOLD,
    );
    const anchors: AnchorWithScore[] = persons.map((person) => ({
      anchor: toPercentPoint(person.anchor),
      detScore: person.detScore,
    }));

    const zones = await this.resolveZones(spaceId, camera);
    const transitions = this.occupancyEngine.evaluate(
      camera.id,
      zones,
      anchors,
    );
    const entries = transitions.filter(
      (transition) => transition.kind === 'entered',
    );

    // The frame is written to MySQL only when it is evidence: a poll that saw
    // nothing would otherwise store a BLOB every tick, and snapshot retention
    // is explicitly not solved yet.
    const snapshotId =
      entries.length > 0
        ? await this.storeEvidence(spaceId, camera, image)
        : null;

    const detectedAt = new Date();
    const alerts: AlertCandidate[] = entries.map((transition) => ({
      cameraId: camera.id,
      cameraLabel: toCameraLabel(camera),
      zoneId: transition.zoneId,
      alertType: transition.alertType,
      detectedAt,
      snapshotId,
      personsDetected: transition.personsInZone,
      confidence: transition.confidence,
    }));
    const zoneResults: ZoneResult[] = zones.map((zone) => ({
      zoneId: zone.zoneId,
      alertType: zone.alertType,
      occupied: anchors.some((candidate) =>
        containsPoint(zone.rectangle, candidate.anchor),
      ),
    }));

    this.statusRegistry.record(camera.id, {
      lastSuccessAt: new Date(),
      lastLatencyMs: Date.now() - startedAt,
      lastPersonsDetected: persons.length > 0,
      zones: zoneResults,
    });

    // History, routing and the socket broadcast happen here rather than in the
    // two callers (the poll tick and the manual analyze route): an alert that is
    // recorded on one path and not the other is the bug this centralizes away.
    if (alerts.length > 0) {
      await this.alertEvents.record(spaceId, alerts);
    }

    return buildData({ persons, zoneResults, alerts });
  }

  /**
   * Full-frame cameras raise their own alert level over the whole image;
   * partial ones raise the level of the rectangle the person walked into. Both
   * go through the same evaluation, so hysteresis behaves identically.
   */
  private async resolveZones(
    spaceId: string,
    camera: Camera,
  ): Promise<ZoneInput[]> {
    if (camera.monitorMode === MonitorMode.full) {
      return camera.alertType
        ? [
            {
              zoneId: null,
              alertType: camera.alertType,
              rectangle: FULL_FRAME,
            },
          ]
        : [];
    }

    const zones = await this.zoneAccessor.findByCamera(spaceId, camera.id);
    return zones.map((zone) => ({
      zoneId: zone.id,
      alertType: zone.alertType,
      rectangle: toRectangle(zone),
    }));
  }

  private async storeEvidence(
    spaceId: string,
    camera: Camera,
    image: CapturedImage,
  ): Promise<string | null> {
    const stored = await this.snapshotService.store(spaceId, camera.id, image);
    return stored.ok ? stored.data.id : null;
  }

  /**
   * A camera that is soft-deleted, switched off or not configured yet has
   * nothing to evaluate. Checked here rather than only in the poll query so the
   * manual analyze route cannot bypass it.
   */
  private rejectUnusableCamera<T>(camera: Camera): Either<T> | undefined {
    if (camera.deletedAt) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${camera.id} not found`);
    }
    if (!camera.isEnabled) {
      return buildError(ErrorCode.CONFLICT, `Camera ${camera.id} is disabled`);
    }
    if (!camera.isConfigured) {
      return buildError(
        ErrorCode.CONFLICT,
        `Camera ${camera.id} has no monitor configuration`,
      );
    }
    return undefined;
  }
}
