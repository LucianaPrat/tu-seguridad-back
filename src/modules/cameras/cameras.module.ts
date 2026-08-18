import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  imports: [PipelineModule, SnapshotsModule],
  controllers: [CamerasController],
  providers: [CamerasService],
})
export class CamerasModule {}
