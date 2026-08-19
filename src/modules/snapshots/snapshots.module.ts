import { Module } from '@nestjs/common';
import { DvrModule } from '../dvr/dvr.module';
import { SnapshotService } from './snapshot.service';
import { SnapshotsController } from './snapshots.controller';

/**
 * Snapshot bytes have exactly one writer (capture from the recorder or an
 * analyzed upload) and exactly one reader (`GET /snapshots/:id`). Both live
 * here so no other module can grow a second path to the BLOB.
 */
@Module({
  imports: [DvrModule],
  controllers: [SnapshotsController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotsModule {}
