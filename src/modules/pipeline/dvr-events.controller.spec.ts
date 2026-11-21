import { ErrorCode } from '../../cross/common/constants';
import { DvrEventStatus } from './dvr-event.listener';
import { DvrEventsController } from './dvr-events.controller';

describe(DvrEventsController.name, () => {
  const user = { spaceId: 'space-a' } as never;
  let listener: { enabled: boolean; statusFor: jest.Mock };
  let controller: DvrEventsController;

  beforeEach(() => {
    listener = { enabled: true, statusFor: jest.fn() };
    controller = new DvrEventsController(listener as never);
  });

  it('answers the caller space status', async () => {
    const status: DvrEventStatus = {
      connected: true,
      since: new Date('2026-11-14T10:00:00Z'),
      lastHeardAt: new Date('2026-11-14T10:05:00Z'),
      lastMotionAt: null,
      lastDrop: null,
    };
    listener.statusFor.mockResolvedValue(status);

    const result = await controller.status(user);

    expect(listener.statusFor).toHaveBeenCalledWith('space-a');
    expect(result).toEqual({ ok: true, data: { enabled: true, ...status } });
  });

  it('answers 404 when the space has no recorder', async () => {
    listener.statusFor.mockResolvedValue(null);

    const result = await controller.status(user);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
  });
});
