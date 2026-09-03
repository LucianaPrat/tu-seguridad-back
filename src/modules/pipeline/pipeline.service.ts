import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Camera, MonitorMode } from '@prisma/client';
import { Counter } from 'prom-client';
import {
  EnvNames,
  ErrorCode,
  PipelineDefaults,
} from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { MonitorZoneAccessorService } from '../../data/accessors/zone.accessor';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { toCameraLabel } from '../cameras/camera.mapper';
import { CapturedImage } from '../dvr/dvr-client.port';
import { AlertEventsService } from '../events/alert-events.service';
import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { FaceAuthClientService } from '../face-auth-client/face-auth-client.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { toZoneArea } from '../zones/zone.mapper';
import { containsPoint, FULL_FRAME, toPercentPoint } from '../zones/rectangle';
import { AlertCandidate } from './alert-candidate';
import { AlertCooldown } from './alert-cooldown';
import { annotateDetections } from './annotate-frame';
import { AnalysisResult, ZoneResult } from './analysis-result';
import { CadenceEngine } from './cadence.engine';
import {
  AnchorWithScore,
  OccupancyEngine,
  ZoneInput,
} from './occupancy.engine';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly faceAuthClient: FaceAuthClientService,
    private readonly zoneAccessor: MonitorZoneAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly occupancyEngine: OccupancyEngine,
    private readonly cadenceEngine: CadenceEngine,
    private readonly alertEvents: AlertEventsService,
    private readonly alertCooldown: AlertCooldown,
    @InjectMetric(MetricNames.PIPELINE_ALERTS_SUPPRESSED_TOTAL)
    private readonly alertsSuppressed: Counter<string>,
    @InjectMetric(MetricNames.PIPELINE_PERSONS_DETECTED_TOTAL)
    private readonly personsDetected: Counter<string>,
  ) {}

  /**
   * Drops everything this process remembers about a camera: the occupancy
   * streak and the poll cadence it had earned. Called when the configuration
   * underneath them moved (zone reshaped or deleted, camera disabled or
   * deleted), which is also what keeps both maps from holding rows for cameras
   * that no longer exist.
   */
  /**
   * The shortest interval the scheduler can honour. Exposed so the camera
   * update route can refuse a per-camera floor below it instead of accepting a
   * number that would quietly do nothing.
   */
  get basePollSeconds(): number {
    return this.cadenceEngine.tickSeconds;
  }

  resetCameraState(cameraId: string): void {
    this.occupancyEngine.reset(cameraId);
    this.cadenceEngine.reset(cameraId);
    this.alertCooldown.reset(cameraId);
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

    // The camera's own threshold when it has one. A camera pointed at a street
    // and one pointed at a hallway need different numbers, and until this
    // existed tuning one detuned the other.
    const threshold =
      camera.confidenceThreshold === null
        ? PipelineDefaults.CONFIDENCE_THRESHOLD
        : Number(camera.confidenceThreshold);
    const persons = detection.data.persons.filter(
      (person) => person.detScore >= threshold,
    );
    // Counted here rather than derived downstream: a poll counted `success`
    // says the pipeline ran, not that anybody was seen, and "the upstream found
    // nobody" and "it found somebody this threshold dropped" are different
    // problems with different owners.
    this.personsDetected.inc({
      cameraId: camera.id,
      outcome: detectionOutcome(detection.data.persons.length, persons.length),
    });
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
    const now = Date.now();
    // Consulted before the frame is stored, not after: a suppressed candidate
    // must not cost a MEDIUMBLOB write either, and repeat alerts are exactly
    // where that volume comes from.
    const entries = transitions
      .filter((transition) => transition.kind === 'entered')
      .filter((transition) => {
        if (
          this.alertCooldown.admit(
            camera.id,
            transition.zoneId,
            transition.alertType,
            now,
          )
        ) {
          return true;
        }
        // Counted, never silent: an alert that never fired and left no trace is
        // indistinguishable from a detection that never happened.
        this.alertsSuppressed.inc({ cameraId: camera.id });
        this.logger.debug(
          `alert suppressed for camera ${camera.id} zone ${transition.zoneId ?? 'full frame'} inside its ${transition.alertType} cooldown`,
        );
        return false;
      });
    // Read after `evaluate`, so it reflects the state this frame just produced.
    const occupancyPending = this.occupancyEngine.hasPendingOccupancy(
      camera.id,
    );

    // The frame is written to MySQL only when it is evidence: a poll that saw
    // nothing would otherwise store a BLOB every tick, and snapshot retention
    // is explicitly not solved yet.
    const snapshotId =
      entries.length > 0
        ? await this.storeEvidence(spaceId, camera, image, persons)
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
        containsPoint(zone.area, candidate.anchor),
      ),
    }));

    this.statusRegistry.record(camera.id, {
      lastSuccessAt: new Date(),
      lastLatencyMs: Date.now() - startedAt,
      lastPersonsDetected: persons.length > 0,
      zones: zoneResults,
    });

    // At info, and bounded by real presence: one line per poll that actually
    // saw somebody. A sighting that confirms no area is the signal the entry
    // window exists to close, and at debug nobody was ever going to see it.
    if (persons.length > 0) {
      this.logger.log(
        `camera ${camera.id} saw ${persons.length} person(s), ${alerts.length} area(s) confirmed`,
      );
    }

    // History, routing and the socket broadcast happen here rather than in the
    // two callers (the poll tick and the manual analyze route): an alert that is
    // recorded on one path and not the other is the bug this centralizes away.
    if (alerts.length > 0) {
      await this.alertEvents.record(spaceId, alerts);
    }

    return buildData({ persons, zoneResults, alerts, occupancyPending });
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
              area: FULL_FRAME,
            },
          ]
        : [];
    }

    const zones = await this.zoneAccessor.findByCamera(spaceId, camera.id);
    return zones.map((zone) => ({
      zoneId: zone.id,
      alertType: zone.alertType,
      area: toZoneArea(zone),
    }));
  }

  /**
   * The stored frame carries the upstream's boxes drawn on it, so the alert
   * email and the dashboard both show where the person actually was rather than
   * leaving the reader to find them. Annotation never fails the write: it hands
   * back the original bytes when it cannot decode the frame, and a write the
   * annotated bytes were rejected for is retried with the frame as captured.
   * Re-encoding can push a frame that was under `SNAPSHOT_MAX_BYTES` over it,
   * and an alert with no evidence at all is the worse outcome.
   */
  private async storeEvidence(
    spaceId: string,
    camera: Camera,
    image: CapturedImage,
    persons: PersonDetection[],
  ): Promise<string | null> {
    const evidence = await annotateDetections(image, persons);
    const stored = await this.snapshotService.store(
      spaceId,
      camera.id,
      evidence,
    );
    // The untouched capture, when the deployment asked for it. The event still
    // points at the annotated frame — this row exists so the upstream's recall
    // can be re-measured on the pixels it actually answered, which the q88
    // re-encode with boxes burned in is not. Its failure is logged and dropped:
    // an audit copy must never cost an alert.
    if (
      stored.ok &&
      evidence !== image &&
      this.configService.get<boolean>(EnvNames.SNAPSHOT_KEEP_RAW)
    ) {
      const raw = await this.snapshotService.store(spaceId, camera.id, image);
      if (!raw.ok) {
        this.logger.warn(
          `raw evidence copy for camera ${camera.id} was not stored: ${raw.code}`,
        );
      }
    }
    if (stored.ok) {
      return stored.data.id;
    }
    if (evidence === image) {
      return null;
    }
    const raw = await this.snapshotService.store(spaceId, camera.id, image);
    return raw.ok ? raw.data.id : null;
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

/**
 * Which of the three things the detector did. `filtered` is deliberately
 * distinct from `empty`: the first is this camera's threshold rejecting a
 * sighting the upstream reported, the second is the upstream reporting nothing
 * at all — and only the second is out of our hands.
 */
function detectionOutcome(
  reported: number,
  kept: number,
): 'persons' | 'empty' | 'filtered' {
  if (reported === 0) {
    return 'empty';
  }
  return kept === 0 ? 'filtered' : 'persons';
}
