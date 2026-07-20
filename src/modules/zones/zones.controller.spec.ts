import { ZonesController } from './zones.controller';

describe('ZonesController', () => {
  let zonesService: {
    findByCamera: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    validate: jest.Mock;
  };
  let controller: ZonesController;

  beforeEach(() => {
    zonesService = {
      findByCamera: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      validate: jest.fn(),
    };
    controller = new ZonesController(zonesService as never);
  });

  it('delegates findByCamera', async () => {
    await controller.findByCamera('camera_01');
    expect(zonesService.findByCamera).toHaveBeenCalledWith('camera_01');
  });

  it('delegates create with the cameraId from the path and the body dto', async () => {
    const dto = { id: 'zone_01', name: 'Lobby', polygon: [] };
    await controller.create('camera_01', dto);
    expect(zonesService.create).toHaveBeenCalledWith('camera_01', dto);
  });

  it('delegates findOne', async () => {
    await controller.findOne('zone_01');
    expect(zonesService.findById).toHaveBeenCalledWith('zone_01');
  });

  it('delegates update', async () => {
    const dto = { name: 'Renamed' };
    await controller.update('zone_01', dto);
    expect(zonesService.update).toHaveBeenCalledWith('zone_01', dto);
  });

  it('delegates remove', async () => {
    await controller.remove('zone_01');
    expect(zonesService.delete).toHaveBeenCalledWith('zone_01');
  });

  it('delegates validate with the override polygon from the body', async () => {
    const polygon = [{ x: 0, y: 0 }];
    await controller.validate('zone_01', { polygon });
    expect(zonesService.validate).toHaveBeenCalledWith('zone_01', polygon);
  });
});
