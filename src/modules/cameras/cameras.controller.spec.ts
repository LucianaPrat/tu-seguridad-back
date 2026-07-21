import { CamerasController } from './cameras.controller';

describe('CamerasController', () => {
  let camerasService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getStatus: jest.Mock;
    analyze: jest.Mock;
  };
  let controller: CamerasController;

  beforeEach(() => {
    camerasService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStatus: jest.fn(),
      analyze: jest.fn(),
    };
    controller = new CamerasController(camerasService as never);
  });

  it('delegates create', async () => {
    const dto = { id: 'camera_01', name: 'Cam', snapshotUrl: 'http://x' };
    await controller.create(dto);
    expect(camerasService.create).toHaveBeenCalledWith(dto);
  });

  it('delegates findAll', async () => {
    await controller.findAll();
    expect(camerasService.findAll).toHaveBeenCalled();
  });

  it('delegates findOne', async () => {
    await controller.findOne('camera_01');
    expect(camerasService.findById).toHaveBeenCalledWith('camera_01');
  });

  it('delegates update', async () => {
    const dto = { name: 'Renamed' };
    await controller.update('camera_01', dto);
    expect(camerasService.update).toHaveBeenCalledWith('camera_01', dto);
  });

  it('delegates remove', async () => {
    await controller.remove('camera_01');
    expect(camerasService.delete).toHaveBeenCalledWith('camera_01');
  });

  it('delegates status', async () => {
    await controller.status('camera_01');
    expect(camerasService.getStatus).toHaveBeenCalledWith('camera_01');
  });

  it('delegates analyze with the uploaded file buffer', async () => {
    const file = { buffer: Buffer.from('img') } as Express.Multer.File;
    await controller.analyze('camera_01', file);
    expect(camerasService.analyze).toHaveBeenCalledWith(
      'camera_01',
      file.buffer,
    );
  });
});
