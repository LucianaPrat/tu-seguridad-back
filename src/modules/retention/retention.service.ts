import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { EnvNames } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { AuthTokenAccessorService } from '../../data/accessors/auth-token.accessor';
import { InvitationAccessorService } from '../../data/accessors/invitation.accessor';
import { SnapshotAccessorService } from '../../data/accessors/snapshot.accessor';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Sweep names are label values on the counter, so they are fixed strings. */
type SweepName = 'auth_tokens' | 'invitations' | 'snapshots';

/**
 * The only thing in this process that deletes a row.
 *
 * Until this landed nothing did: consumed tokens, expired invitations and
 * every evidence frame ever captured accumulated on the same MySQL instance
 * that serves every query, and a `MEDIUMBLOB` per alert is the one of those
 * that grows without a ceiling.
 *
 * One job for all three sweeps rather than one job each, because they are the
 * same decision — "what is old enough to go" — asked of three tables, and
 * three cron entries would be three things to notice had stopped.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authTokenAccessor: AuthTokenAccessorService,
    private readonly invitationAccessor: InvitationAccessorService,
    private readonly snapshotAccessor: SnapshotAccessorService,
    @InjectMetric(MetricNames.RETENTION_ROWS_DELETED_TOTAL)
    private readonly rowsDeleted: Counter<string>,
  ) {}

  /**
   * Public so a spec can drive it, and so an operator rehearsing the windows
   * has something to call. The schedule is the only caller in production.
   *
   * A quiet hour rather than a configurable one: the sweep is capped and short,
   * and a cron expression in an env var is a way to break the job by typo.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention-sweep' })
  async sweep(): Promise<void> {
    if (!this.configService.get<boolean>(EnvNames.RETENTION_ENABLED)) {
      return;
    }

    const limit = this.configService.getOrThrow<number>(
      EnvNames.RETENTION_BATCH_SIZE,
    );

    await this.run('auth_tokens', EnvNames.RETENTION_TOKEN_DAYS, (before) =>
      this.authTokenAccessor.deleteSpentBefore(before, limit),
    );
    await this.run(
      'invitations',
      EnvNames.RETENTION_INVITATION_DAYS,
      (before) => this.invitationAccessor.deleteSettledBefore(before, limit),
    );
    await this.run('snapshots', EnvNames.RETENTION_SNAPSHOT_DAYS, (before) =>
      this.snapshotAccessor.deleteEvidenceBefore(before, limit),
    );
  }

  /**
   * One sweep. A failure is logged and the next sweep still runs: the three are
   * independent, and a snapshot table that will not delete is no reason to keep
   * expired credentials around for another day.
   */
  private async run(
    sweep: SweepName,
    windowVar: string,
    remove: (before: Date) => Promise<number>,
  ): Promise<void> {
    const days = this.configService.getOrThrow<number>(windowVar);
    const before = new Date(Date.now() - days * MS_PER_DAY);
    try {
      const count = await remove(before);
      this.rowsDeleted.inc({ sweep }, count);
      if (count > 0) {
        this.logger.log(
          `retention swept ${count} ${sweep} rows older than ${days} days`,
        );
      }
    } catch (error) {
      this.logger.error(
        `retention sweep ${sweep} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
