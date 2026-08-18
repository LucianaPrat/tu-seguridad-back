import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { ZonesController } from './zones.controller';

describe('ZonesController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let zonesService: {
    findByCamera: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let controller: ZonesController;

  beforeEach(() => {
    zonesService = {
      findByCamera: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    controller = new ZonesController(zonesService as never);
  });

  it('delegates findByCamera with the caller space', async () => {
    await controller.findByCamera(user, 'camera-uuid');
    expect(zonesService.findByCamera).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
    );
  });

  it('delegates create', async () => {
    const dto = {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      alertType: 'intruder' as const,
    };
    await controller.create(user, 'camera-uuid', dto);
    expect(zonesService.create).toHaveBeenCalledWith(
      'space-uuid',
      'camera-uuid',
      dto,
    );
  });

  it('delegates findOne', async () => {
    await controller.findOne(user, 'zone-uuid');
    expect(zonesService.findById).toHaveBeenCalledWith(
      'space-uuid',
      'zone-uuid',
    );
  });

  it('delegates update', async () => {
    const dto = { x: 5 };
    await controller.update(user, 'zone-uuid', dto);
    expect(zonesService.update).toHaveBeenCalledWith(
      'space-uuid',
      'zone-uuid',
      dto,
    );
  });

  it('delegates remove', async () => {
    await controller.remove(user, 'zone-uuid');
    expect(zonesService.delete).toHaveBeenCalledWith('space-uuid', 'zone-uuid');
  });
});
