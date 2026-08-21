import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DvrModule } from '../dvr/dvr.module';
import { LiveStreamService } from './live-stream.service';
import { MediaMtxStreamPublisherService } from './mediamtx-stream-publisher.service';
import { StreamPublisherPort } from './stream-publisher.port';
import { StreamingController } from './streaming.controller';

/**
 * Owns the media-server boundary. `AuthModule` is imported for `JwtService`
 * alone: the authorization hook has to verify a token that arrives in a body,
 * where no guard can reach it.
 *
 * There is one publisher and no "disabled" second class behind a factory, the
 * way mail does it. Mail off has a meaningful fallback — log the credential.
 * Streaming off has none: there is no stream, so the honest answer is one
 * refusal, and `LiveStreamService.start` gives it before any work happens rather
 * than after the recorder password has been decrypted.
 */
@Module({
  imports: [HttpModule, AuthModule, DvrModule],
  controllers: [StreamingController],
  providers: [
    LiveStreamService,
    { provide: StreamPublisherPort, useClass: MediaMtxStreamPublisherService },
  ],
  exports: [LiveStreamService],
})
export class StreamingModule {}
