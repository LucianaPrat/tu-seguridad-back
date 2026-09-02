import { Global, Module } from '@nestjs/common';
import {
  getToken,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';
import { MetricNames } from './metric-names';
import { MetricsController } from './metrics.controller';
import { MetricsTokenGuard } from './metrics-token.guard';

const metricProviders = [
  makeHistogramProvider({
    name: MetricNames.HTTP_REQUEST_DURATION_SECONDS,
    help: 'Duration of inbound HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  makeCounterProvider({
    name: MetricNames.THROTTLER_REJECTIONS_TOTAL,
    help: 'Total number of requests rejected by the rate limiter (429)',
  }),
  makeGaugeProvider({
    name: MetricNames.WEBSOCKET_CONNECTIONS_ACTIVE,
    help: 'Number of currently connected authenticated WebSocket clients',
  }),
  // Labelled per camera on purpose: eight of them, so 24 series at three
  // outcomes, and a camera whose recorder is slow or whose channel is dead is
  // exactly what a poll-duration panel has to be able to single out.
  makeCounterProvider({
    name: MetricNames.PIPELINE_POLL_TOTAL,
    help: 'Total number of camera poll ticks by camera and outcome',
    labelNames: ['cameraId', 'status'],
  }),
  makeHistogramProvider({
    name: MetricNames.PIPELINE_POLL_DURATION_SECONDS,
    help: 'Duration of a single camera poll tick in seconds',
    labelNames: ['cameraId'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  // The poll metrics time the whole cycle; these separate the recorder from
  // the detector, which is the "is it the camera or the upstream" question
  // nothing could answer before. Labelled by channel because that is what the
  // client knows — a BNC port, eight of them.
  //
  // ponytail: per-channel labels on a fleet of eight. They come off if the
  // estate ever grows past a few dozen.
  makeCounterProvider({
    name: MetricNames.DVR_CAPTURE_TOTAL,
    help: 'Recorder snapshot captures by channel and outcome',
    labelNames: ['channel', 'outcome'],
  }),
  makeCounterProvider({
    name: MetricNames.DVR_CAPTURE_RETRY_TOTAL,
    help: 'Recorder snapshot captures retried after a transient failure',
    labelNames: ['channel'],
  }),
  // An alert that never fired and left no trace is indistinguishable from a
  // detection that never happened, so suppression is counted rather than silent.
  makeCounterProvider({
    name: MetricNames.PIPELINE_ALERTS_SUPPRESSED_TOTAL,
    help: 'Alert candidates suppressed by the per-zone cooldown, by camera',
    labelNames: ['cameraId'],
  }),
  // Labelled by sweep, three series. A sweep that silently stops deleting is
  // indistinguishable from one with nothing left to delete unless the counter
  // is there to flatten.
  makeCounterProvider({
    name: MetricNames.RETENTION_ROWS_DELETED_TOTAL,
    help: 'Total rows removed by the retention sweeps, by sweep',
    labelNames: ['sweep'],
  }),
];

const metricTokens = Object.values(MetricNames).map((name) => getToken(name));

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [...metricProviders, MetricsTokenGuard],
  exports: [...metricTokens],
})
export class MetricsModule {}
