import { ConfigService } from '@nestjs/config';
import { Counter } from 'prom-client';
import { EnvNames } from '../../cross/common/constants';
import { RetentionService } from './retention.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-01T03:00:00.000Z').getTime();

describe('RetentionService', () => {
  let config: Record<string, unknown>;
  let authTokenAccessor: { deleteSpentBefore: jest.Mock };
  let invitationAccessor: { deleteSettledBefore: jest.Mock };
  let snapshotAccessor: { deleteEvidenceBefore: jest.Mock };
  let memberActivityAccessor: {
    deleteLoginsBefore: jest.Mock;
    deleteWatchBefore: jest.Mock;
  };
  let rowsDeleted: { inc: jest.Mock };
  let service: RetentionService;

  const build = () => {
    const configService = {
      get: (key: string) => config[key],
      getOrThrow: (key: string) => {
        const value = config[key];
        if (value === undefined) {
          throw new Error(`missing ${key}`);
        }
        return value;
      },
    } as unknown as ConfigService;
    return new RetentionService(
      configService,
      authTokenAccessor as never,
      invitationAccessor as never,
      snapshotAccessor as never,
      memberActivityAccessor as never,
      rowsDeleted as unknown as Counter<string>,
    );
  };

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    config = {
      [EnvNames.RETENTION_ENABLED]: true,
      [EnvNames.RETENTION_BATCH_SIZE]: 500,
      [EnvNames.RETENTION_TOKEN_DAYS]: 30,
      [EnvNames.RETENTION_INVITATION_DAYS]: 30,
      [EnvNames.RETENTION_SNAPSHOT_DAYS]: 90,
      [EnvNames.RETENTION_ACTIVITY_DAYS]: 400,
    };
    authTokenAccessor = { deleteSpentBefore: jest.fn().mockResolvedValue(3) };
    invitationAccessor = {
      deleteSettledBefore: jest.fn().mockResolvedValue(0),
    };
    snapshotAccessor = { deleteEvidenceBefore: jest.fn().mockResolvedValue(7) };
    memberActivityAccessor = {
      deleteLoginsBefore: jest.fn().mockResolvedValue(2),
      deleteWatchBefore: jest.fn().mockResolvedValue(5),
    };
    rowsDeleted = { inc: jest.fn() };
    service = build();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing at all when retention is off', async () => {
    config[EnvNames.RETENTION_ENABLED] = false;

    await build().sweep();

    expect(authTokenAccessor.deleteSpentBefore).not.toHaveBeenCalled();
    expect(invitationAccessor.deleteSettledBefore).not.toHaveBeenCalled();
    expect(snapshotAccessor.deleteEvidenceBefore).not.toHaveBeenCalled();
  });

  it('sweeps each table at its own window, capped at the batch size', async () => {
    await service.sweep();

    expect(authTokenAccessor.deleteSpentBefore).toHaveBeenCalledWith(
      new Date(NOW - 30 * MS_PER_DAY),
      500,
    );
    expect(invitationAccessor.deleteSettledBefore).toHaveBeenCalledWith(
      new Date(NOW - 30 * MS_PER_DAY),
      500,
    );
    expect(snapshotAccessor.deleteEvidenceBefore).toHaveBeenCalledWith(
      new Date(NOW - 90 * MS_PER_DAY),
      500,
    );
  });

  it('sweeps the activity tables at the activity window', async () => {
    await service.sweep();

    const before = new Date(NOW - 400 * MS_PER_DAY);
    expect(memberActivityAccessor.deleteLoginsBefore).toHaveBeenCalledWith(
      before,
      500,
    );
    expect(memberActivityAccessor.deleteWatchBefore).toHaveBeenCalledWith(
      before,
      500,
    );
  });

  it('counts what each sweep removed, including a sweep that removed nothing', async () => {
    await service.sweep();

    expect(rowsDeleted.inc).toHaveBeenCalledWith({ sweep: 'auth_tokens' }, 3);
    expect(rowsDeleted.inc).toHaveBeenCalledWith({ sweep: 'invitations' }, 0);
    expect(rowsDeleted.inc).toHaveBeenCalledWith({ sweep: 'snapshots' }, 7);
  });

  /**
   * The three are independent. A snapshot table that will not delete is no
   * reason to leave expired credentials in place for another day.
   */
  it('runs the remaining sweeps when one fails', async () => {
    authTokenAccessor.deleteSpentBefore.mockRejectedValue(
      new Error('deadlock'),
    );

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(invitationAccessor.deleteSettledBefore).toHaveBeenCalled();
    expect(snapshotAccessor.deleteEvidenceBefore).toHaveBeenCalled();
    expect(rowsDeleted.inc).not.toHaveBeenCalledWith(
      { sweep: 'auth_tokens' },
      expect.anything(),
    );
  });
});
