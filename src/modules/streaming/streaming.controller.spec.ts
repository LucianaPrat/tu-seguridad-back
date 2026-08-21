import { StreamingController } from './streaming.controller';

describe('StreamingController', () => {
  it('delegates the media-server hook with the body it received', async () => {
    const liveStreamService = { authorize: jest.fn() };
    const controller = new StreamingController(liveStreamService as never);
    const dto = { action: 'read', path: 'camera-uuid', token: 'access-token' };

    await controller.authorize(dto);

    expect(liveStreamService.authorize).toHaveBeenCalledWith(dto);
  });
});
