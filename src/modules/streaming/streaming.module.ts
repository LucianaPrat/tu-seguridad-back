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
 * There is one publisher and it checks `MEDIAMTX_ENABLED` itself rather than a
 * second "disabled" class behind a factory, the way mail does. Mail off has a
 * meaningful fallback — log the credential. Streaming off has none: there is no
 * stream, so the honest answer is one refusal inside the one implementation.
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
