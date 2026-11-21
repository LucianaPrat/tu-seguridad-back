import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DvrEventsHealthIndicator } from './dvr-events.health-indicator';
import { FaceAuthHealthIndicator } from './face-auth.health-indicator';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health-indicator';

@Module({
  imports: [TerminusModule, HttpModule, PipelineModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    FaceAuthHealthIndicator,
    DvrEventsHealthIndicator,
  ],
})
export class HealthModule {}
