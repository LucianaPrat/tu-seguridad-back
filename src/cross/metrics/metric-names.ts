export const MetricNames = {
  HTTP_REQUEST_DURATION_SECONDS: 'http_request_duration_seconds',
  THROTTLER_REJECTIONS_TOTAL: 'throttler_rejections_total',
  WEBSOCKET_CONNECTIONS_ACTIVE: 'websocket_connections_active',
  PIPELINE_POLL_TOTAL: 'pipeline_poll_total',
  PIPELINE_POLL_DURATION_SECONDS: 'pipeline_poll_duration_seconds',
  PIPELINE_ALERTS_SUPPRESSED_TOTAL: 'pipeline_alerts_suppressed_total',
  DVR_CAPTURE_TOTAL: 'dvr_capture_total',
  DVR_CAPTURE_RETRY_TOTAL: 'dvr_capture_retry_total',
  RETENTION_ROWS_DELETED_TOTAL: 'retention_rows_deleted_total',
} as const;
