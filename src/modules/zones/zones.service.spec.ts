import { MonitorZone, Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { ZonesService } from './zones.service';

function buildZone(overrides: Partial<MonitorZone> = {}): MonitorZone {
  return {
    id: 'zone-uuid',
    cameraId: 'camera-uuid',
    x: new Prisma.Decimal(10),
    y: new Prisma.Decimal(20),
    width: new Prisma.Decimal(30),
    height: new Prisma.Decimal(40),
    points: null,
    alertType: 'intruder',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ZonesService', () => {
  const spaceId = 'space-uuid';
  const validRectangle = { x: 10, y: 10, width: 20, height: 20 };
  /** A triangle: bounding box x 10, y 10, width 40, height 30. */
  const outline = [
    { x: 30, y: 10 },
    { x: 10, y: 40 },
    { x: 50, y: 25 },
  ];

  let zoneAccessor: {
    findByCamera: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let cameraAccessor: {
    findById: jest.Mock;
    update: jest.Mock;
    countMonitorZones: jest.Mock;
  };
  let service: ZonesService;

  beforeEach(() => {
    zoneAccessor = {
      findByCamera: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    cameraAccessor = {
      findById: jest.fn(),
      update: jest.fn(),
      countMonitorZones: jest.fn(),
    };
    service = new ZonesService(zoneAccessor as never, cameraAccessor as never);
  });

  describe('create', () => {
    it('rejects a rectangle that runs past the right edge of the frame', async () => {
      const result = await service.create(spaceId, 'camera-uuid', {
        x: 90,
        y: 10,
        width: 20,
        height: 10,
        alertType: 'intruder',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
      expect(zoneAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects a zero-sized rectangle', async () => {
      const result = await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        width: 0,
        alertType: 'intruder',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
    });

    it('derives the stored rectangle from the outline and ignores the sent box', async () => {
      zoneAccessor.create.mockResolvedValue(buildZone());
      cameraAccessor.findById.mockResolvedValue(null);

      await service.create(spaceId, 'camera-uuid', {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        points: outline,
        alertType: 'intruder',
      });

      expect(zoneAccessor.create).toHaveBeenCalledWith(spaceId, {
        cameraId: 'camera-uuid',
        x: 10,
        y: 10,
        width: 40,
        height: 30,
        points: outline,
        alertType: 'intruder',
      });
    });

    it('stores no outline when the request carries none', async () => {
      zoneAccessor.create.mockResolvedValue(buildZone());
      cameraAccessor.findById.mockResolvedValue(null);

      await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        alertType: 'intruder',
      });

      expect(zoneAccessor.create).toHaveBeenCalledWith(spaceId, {
        cameraId: 'camera-uuid',
        ...validRectangle,
        points: Prisma.DbNull,
        alertType: 'intruder',
      });
    });

    it('rejects an outline that leaves the frame', async () => {
      const result = await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        points: [
          { x: 10, y: 10 },
          { x: 120, y: 10 },
          { x: 10, y: 40 },
        ],
        alertType: 'intruder',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
      expect(zoneAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects an outline of two points, which encloses nothing', async () => {
      const result = await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
        alertType: 'intruder',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
    });

    it('returns NOT_FOUND when the camera belongs to another space', async () => {
      zoneAccessor.create.mockResolvedValue(null);

      const result = await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        alertType: 'intruder',
      });

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('returns the zone as numbers, not decimal strings', async () => {
      zoneAccessor.create.mockResolvedValue(buildZone());
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        alertType: 'intruder',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toMatchObject({
          x: 10,
          y: 20,
          width: 30,
          height: 40,
        });
      }
    });

    it('marks a partial camera configured once its first zone exists', async () => {
      zoneAccessor.create.mockResolvedValue(buildZone());
      cameraAccessor.findById.mockResolvedValue({
        id: 'camera-uuid',
        monitorMode: 'partial',
      });
      cameraAccessor.countMonitorZones.mockResolvedValue(1);

      await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        alertType: 'intruder',
      });

      expect(cameraAccessor.update).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
        { isConfigured: true },
      );
    });

    it('leaves a full-frame camera configuration alone', async () => {
      zoneAccessor.create.mockResolvedValue(buildZone());
      cameraAccessor.findById.mockResolvedValue({
        id: 'camera-uuid',
        monitorMode: 'full',
      });

      await service.create(spaceId, 'camera-uuid', {
        ...validRectangle,
        alertType: 'intruder',
      });

      expect(cameraAccessor.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('validates the merged rectangle, not only the submitted fields', async () => {
      zoneAccessor.findById.mockResolvedValue(
        buildZone({ x: new Prisma.Decimal(80), width: new Prisma.Decimal(20) }),
      );

      const result = await service.update(spaceId, 'zone-uuid', { x: 90 });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
      expect(zoneAccessor.update).not.toHaveBeenCalled();
    });

    it('keeps the stored alert level when the update omits it', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone());
      zoneAccessor.update.mockResolvedValue(
        buildZone({ x: new Prisma.Decimal(5) }),
      );

      await service.update(spaceId, 'zone-uuid', { x: 5 });

      expect(zoneAccessor.update).toHaveBeenCalledWith(spaceId, 'zone-uuid', {
        x: 5,
        y: 20,
        width: 30,
        height: 40,
        alertType: 'intruder',
      });
    });

    it('refuses to move the box of a free-hand zone without its outline', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone({ points: outline }));

      const result = await service.update(spaceId, 'zone-uuid', { x: 5 });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.INVALID_ZONE,
      });
      expect(zoneAccessor.update).not.toHaveBeenCalled();
    });

    it('re-derives the box from a new outline', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone());
      zoneAccessor.update.mockResolvedValue(buildZone());

      await service.update(spaceId, 'zone-uuid', { points: outline });

      expect(zoneAccessor.update).toHaveBeenCalledWith(spaceId, 'zone-uuid', {
        x: 10,
        y: 10,
        width: 40,
        height: 30,
        points: outline,
        alertType: 'intruder',
      });
    });

    it('clears the outline and keeps the merged box on explicit null', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone({ points: outline }));
      zoneAccessor.update.mockResolvedValue(buildZone());

      const result = await service.update(spaceId, 'zone-uuid', {
        points: null,
        ...validRectangle,
      });

      expect(result).toMatchObject({ ok: true });
      expect(zoneAccessor.update).toHaveBeenCalledWith(spaceId, 'zone-uuid', {
        ...validRectangle,
        points: Prisma.DbNull,
        alertType: 'intruder',
      });
    });

    it('changes the alert level of a free-hand zone without touching its shape', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone({ points: outline }));
      zoneAccessor.update.mockResolvedValue(buildZone({ points: outline }));

      await service.update(spaceId, 'zone-uuid', { alertType: 'suspicious' });

      expect(zoneAccessor.update).toHaveBeenCalledWith(spaceId, 'zone-uuid', {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        alertType: 'suspicious',
      });
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND for a zone outside the space', async () => {
      zoneAccessor.findById.mockResolvedValue(null);

      const result = await service.delete(spaceId, 'zone-uuid');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
      expect(zoneAccessor.softDelete).not.toHaveBeenCalled();
    });

    it('disarms a partial camera when its last zone is deleted', async () => {
      zoneAccessor.findById.mockResolvedValue(buildZone());
      zoneAccessor.softDelete.mockResolvedValue(true);
      cameraAccessor.findById.mockResolvedValue({
        id: 'camera-uuid',
        monitorMode: 'partial',
      });
      cameraAccessor.countMonitorZones.mockResolvedValue(0);

      const result = await service.delete(spaceId, 'zone-uuid');

      expect(result).toEqual({ ok: true, data: null });
      expect(cameraAccessor.update).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
        { isConfigured: false },
      );
    });
  });
});
