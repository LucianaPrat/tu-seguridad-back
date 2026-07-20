import { Global, Module } from '@nestjs/common';
import { CameraStatusRegistry } from './camera-status.registry';

/**
 * Global so CamerasModule (reads, GET /status) and PipelineModule (writes,
 * every poll/analyze) can both depend on it without depending on each other.
 */
@Global()
@Module({
  providers: [CameraStatusRegistry],
  exports: [CameraStatusRegistry],
})
export class CameraStatusModule {}
