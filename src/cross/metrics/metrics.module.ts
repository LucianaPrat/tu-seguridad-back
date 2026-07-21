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
  makeCounterProvider({
    name: MetricNames.PIPELINE_POLL_TOTAL,
    help: 'Total number of camera poll ticks by outcome',
    labelNames: ['status'],
  }),
  makeHistogramProvider({
    name: MetricNames.PIPELINE_POLL_DURATION_SECONDS,
    help: 'Duration of a single camera poll tick in seconds',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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
