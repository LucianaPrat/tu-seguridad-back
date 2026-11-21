import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

@Module({
  imports: [PipelineModule],
  controllers: [ZonesController],
  providers: [ZonesService],
})
export class ZonesModule {}
