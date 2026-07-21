import { ErrorCode } from '../../cross/common/constants';
import { ZonesService } from './zones.service';

describe('ZonesService', () => {
  const validSquare = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  const camera = { id: 'camera_01' };

  const zone = {
    id: 'zone_lobby',
    cameraId: 'camera_01',
    name: 'Lobby',
    enabled: true,
    polygon: validSquare,
    geometryVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  let zoneAccessor: {
    findByCamera: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let cameraAccessor: { findById: jest.Mock };
  let service: ZonesService;

  beforeEach(() => {
    zoneAccessor = {
      findByCamera: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    cameraAccessor = { findById: jest.fn() };
    service = new ZonesService(zoneAccessor as never, cameraAccessor as never);
  });

  describe('create', () => {
    it('returns NOT_FOUND when the camera does not exist', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.create('camera_missing', {
        id: 'zone_lobby',
        name: 'Lobby',
        polygon: validSquare,
      });

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(zoneAccessor.create).not.toHaveBeenCalled();
    });

    it('returns CONFLICT when the zone id is already taken', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      zoneAccessor.findById.mockResolvedValue(zone);

      const result = await service.create('camera_01', {
        id: 'zone_lobby',
        name: 'Lobby',
        polygon: validSquare,
      });

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(zoneAccessor.create).not.toHaveBeenCalled();
    });

    it('returns INVALID_POLYGON for a geometrically invalid polygon', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      zoneAccessor.findById.mockResolvedValue(null);

      const result = await service.create('camera_01', {
        id: 'zone_lobby',
        name: 'Lobby',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      });

      expect(result).toMatchObject({ code: ErrorCode.INVALID_POLYGON });
      expect(zoneAccessor.create).not.toHaveBeenCalled();
    });

    it('creates a zone with geometryVersion 1 when everything checks out', async () => {
      cameraAccessor.findById.mockResolvedValue(camera);
      zoneAccessor.findById.mockResolvedValue(null);
      zoneAccessor.create.mockResolvedValue(zone);

      const result = await service.create('camera_01', {
        id: 'zone_lobby',
        name: 'Lobby',
        polygon: validSquare,
      });

      expect(result.ok).toBe(true);
      expect(zoneAccessor.create).toHaveBeenCalledWith(
        expect.objectContaining({ cameraId: 'camera_01', geometryVersion: 1 }),
      );
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND for a missing zone', async () => {
      zoneAccessor.findById.mockResolvedValue(null);

      const result = await service.update('zone_missing', {});

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('bumps geometryVersion when the polygon changes', async () => {
      zoneAccessor.findById.mockResolvedValue(zone);
      zoneAccessor.update.mockResolvedValue({ ...zone, geometryVersion: 2 });

      const result = await service.update('zone_lobby', {
        polygon: validSquare,
      });

      expect(result.ok).toBe(true);
      expect(zoneAccessor.update).toHaveBeenCalledWith(
        'zone_lobby',
        expect.objectContaining({ geometryVersion: 2 }),
      );
    });

    it('does not bump geometryVersion when the polygon is unchanged', async () => {
      zoneAccessor.findById.mockResolvedValue(zone);
      zoneAccessor.update.mockResolvedValue({ ...zone, name: 'Renamed' });

      const result = await service.update('zone_lobby', {
        name: 'Renamed',
      });

      expect(result.ok).toBe(true);
      expect(zoneAccessor.update).toHaveBeenCalledWith(
        'zone_lobby',
        expect.objectContaining({ geometryVersion: 1 }),
      );
    });

    it('returns INVALID_POLYGON without bumping geometryVersion for a bad polygon', async () => {
      zoneAccessor.findById.mockResolvedValue(zone);

      const result = await service.update('zone_lobby', {
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      });

      expect(result).toMatchObject({ code: ErrorCode.INVALID_POLYGON });
      expect(zoneAccessor.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND for a missing zone', async () => {
      zoneAccessor.findById.mockResolvedValue(null);

      const result = await service.delete('zone_missing');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('deletes an existing zone', async () => {
      zoneAccessor.findById.mockResolvedValue(zone);

      const result = await service.delete('zone_lobby');

      expect(result).toEqual({ ok: true, data: null });
      expect(zoneAccessor.delete).toHaveBeenCalledWith('zone_lobby');
    });
  });

  describe('validate', () => {
    it('returns NOT_FOUND when no override is given and the zone does not exist', async () => {
      zoneAccessor.findById.mockResolvedValue(null);

      const result = await service.validate('zone_missing');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('validates the stored polygon when no override is given', async () => {
      zoneAccessor.findById.mockResolvedValue(zone);

      const result = await service.validate('zone_lobby');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ valid: true, violations: [] });
      }
    });

    it('always returns 200-shaped data (never an Either error) for an invalid override polygon', async () => {
      const result = await service.validate('zone_lobby', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.valid).toBe(false);
        expect(result.data.violations.length).toBeGreaterThan(0);
      }
      expect(zoneAccessor.findById).not.toHaveBeenCalled();
    });
  });
});
