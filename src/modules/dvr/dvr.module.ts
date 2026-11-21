import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DvrClientPort } from './dvr-client.port';
import { DvrController } from './dvr.controller';
import { DvrService } from './dvr.service';
import { HttpDvrClientService } from './http-dvr-client.service';

/**
 * Owns the recorder boundary. `DvrClientPort` is exported rather than the HTTP
 * implementation so the pipeline depends on the contract, and swapping the
 * appliance protocol stays a one-provider change.
 */
@Module({
  imports: [HttpModule],
  controllers: [DvrController],
  providers: [
    DvrService,
    { provide: DvrClientPort, useClass: HttpDvrClientService },
  ],
  exports: [DvrClientPort],
})
export class DvrModule {}
