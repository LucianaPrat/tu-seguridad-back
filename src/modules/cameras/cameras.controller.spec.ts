import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CamerasController } from './cameras.controller';

describe('CamerasController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let camerasService: {
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getStatus: jest.Mock;
    capture: jest.Mock;
    analyze: jest.Mock;
  };
  let liveStreamService: { start: jest.Mock };
  let controller: CamerasController;

  beforeEach(() => {
    camerasService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStatus: jest.fn(),
      capture: jest.fn(),
      analyze: jest.fn(),
    };
    liveStreamService = { start: jest.fn() };
    controller = new CamerasController(
      camerasService as never,
      liveStreamService as never,
    );
  });

  it('delegates findAll with the caller space', async () => {
    await controller.findAll(user);
    expect(camerasService.findAll).toHaveBeenCalledWith('space-uuid');
  });

  it('delegates findOne with the caller space', async () => {
    await controller.findOne(user, 'camera-uuid');
    expect(camerasService.findById).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates update', async () => {
    const dto = { name: 'Renamed' };
    await controller.update(user, 'camera-uuid', dto);
    expect(camerasService.update).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
      dto,
    );
  });

  it('delegates remove', async () => {
    await controller.remove(user, 'camera-uuid');
    expect(camerasService.delete).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates status', async () => {
    await controller.status(user, 'camera-uuid');
    expect(camerasService.getStatus).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates live to the stream service with the caller space', async () => {
    await controller.live(user, 'camera-uuid');
    expect(liveStreamService.start).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates capture', async () => {
    await controller.capture(user, 'camera-uuid');
    expect(camerasService.capture).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates analyze with the uploaded bytes and their mime type', async () => {
    const file = {
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    await controller.analyze(user, 'camera-uuid', file);

    expect(camerasService.analyze).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
      file.buffer,
      'image/jpeg',
    );
  });
});
