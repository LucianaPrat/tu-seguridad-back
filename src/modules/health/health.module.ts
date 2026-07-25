import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { FaceAuthHealthIndicator } from './face-auth.health-indicator';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health-indicator';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, FaceAuthHealthIndicator],
})
export class HealthModule {}
