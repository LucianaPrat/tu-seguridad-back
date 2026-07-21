import { ErrorCode } from '../../cross/common/constants';
import { CamerasService } from './cameras.service';

describe('CamerasService', () => {
  const camera = {
    id: 'camera_01',
    name: 'Front door',
    enabled: true,
    snapshotUrl: 'http://user:pass@192.168.1.50/snapshot.jpg',
    pollingIntervalSeconds: 5,
    confidenceThreshold: 0.45,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  let cameraAccessor: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    countZones: jest.Mock;
  };
  let statusRegistry: { get: jest.Mock };
  let pipelineService: { processImage: jest.Mock };
  let service: CamerasService;

  beforeEach(() => {
    cameraAccessor = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countZones: jest.fn(),
    };
    statusRegistry = { get: jest.fn() };
    pipelineService = { processImage: jest.fn() };
    service = new CamerasService(
      cameraAccessor as never,
      statusRegistry as never,
      pipelineService as never,
    );
  });

  describe('create', () => {
    it('creates a camera when the id is free', async () => {
      cameraAccessor.findById.mockResolvedValue(null);
      cameraAccessor.create.mockResolvedValue(camera);

      const result = await service.create({
        id: 'camera_01',
        name: 'Front door',
        snapshotUrl: camera.snapshotUrl,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('camera_01');
      }
      expect(cameraAccessor.create).toHaveBeenCalled();
    });

    it('returns CONFLICT when the id is already taken', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);

      const result = await service.create({
        id: 'camera_01',
        name: 'Front door',
        snapshotUrl: camera.snapshotUrl,
      });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(cameraAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('masks snapshotUrl on every list item', async () => {
      cameraAccessor.findAll.mockResolvedValue([camera]);

      const result = await service.findAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].snapshotUrl).toBe('***');
        expect(result.data[0].id).toBe('camera_01');
      }
    });
  });

  describe('findById', () => {
    it('returns the full snapshotUrl on detail', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);

      const result = await service.findById('camera_01');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.snapshotUrl).toBe(camera.snapshotUrl);
      }
    });

    it('returns NOT_FOUND for a missing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.findById('camera_missing');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND when updating a missing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.update('camera_missing', {});

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(cameraAccessor.update).not.toHaveBeenCalled();
    });

    it('updates an existing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      cameraAccessor.update.mockResolvedValue({ ...camera, name: 'Updated' });

      const result = await service.update('camera_01', {
        name: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('Updated');
      }
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND for a missing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.delete('camera_missing');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('returns CONFLICT when the camera still has zones', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      cameraAccessor.countZones.mockResolvedValue(2);

      const result = await service.delete('camera_01');

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(cameraAccessor.delete).not.toHaveBeenCalled();
    });

    it('deletes a camera with no zones', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      cameraAccessor.countZones.mockResolvedValue(0);

      const result = await service.delete('camera_01');

      expect(result).toEqual({ ok: true, data: null });
      expect(cameraAccessor.delete).toHaveBeenCalledWith('camera_01');
    });
  });

  describe('getStatus', () => {
    it('returns NOT_FOUND for a missing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.getStatus('camera_missing');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('returns the registry snapshot for an existing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      statusRegistry.get.mockReturnValue({
        cameraId: 'camera_01',
        lastPolledAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        lastLatencyMs: null,
        lastPersonsDetected: null,
      });

      const result = await service.getStatus('camera_01');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cameraId).toBe('camera_01');
      }
    });
  });

  describe('analyze', () => {
    it('returns NOT_FOUND for a missing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.analyze('camera_missing', Buffer.from(''));

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(pipelineService.processImage).not.toHaveBeenCalled();
    });

    it('delegates to PipelineService.processImage for an existing camera', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      const analysisResult = {
        persons: [],
        zoneResults: [],
        eventsEmitted: [],
      };
      pipelineService.processImage.mockResolvedValue({
        ok: true,
        data: analysisResult,
      });
      const image = Buffer.from('jpeg-bytes');

      const result = await service.analyze('camera_01', image);

      expect(pipelineService.processImage).toHaveBeenCalledWith(camera, image);
      expect(result).toEqual({ ok: true, data: analysisResult });
    });
  });
});
