import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  imports: [PipelineModule],
  controllers: [CamerasController],
  providers: [CamerasService],
})
export class CamerasModule {}
