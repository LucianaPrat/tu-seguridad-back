import { Module } from '@nestjs/common';
import { CameraStatusRegistry } from './camera-status.registry';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  controllers: [CamerasController],
  providers: [CamerasService, CameraStatusRegistry],
  exports: [CameraStatusRegistry],
})
export class CamerasModule {}
