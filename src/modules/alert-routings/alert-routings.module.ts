import { Module } from '@nestjs/common';
import { AlertRoutingsController } from './alert-routings.controller';
import { AlertRoutingsService } from './alert-routings.service';

@Module({
  controllers: [AlertRoutingsController],
  providers: [AlertRoutingsService],
})
export class AlertRoutingsModule {}
