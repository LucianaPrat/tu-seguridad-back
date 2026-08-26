import { AlertRouting } from '@prisma/client';
import { AlertRoutingsService } from './alert-routings.service';

function buildRow(overrides: Partial<AlertRouting> = {}): AlertRouting {
  return {
    id: 'row-uuid',
    spaceId: 'space-uuid',
    alertType: 'intruder',
    channel: 'email',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AlertRoutingsService', () => {
  const spaceId = 'space-uuid';

  let alertRoutingAccessor: { listBySpace: jest.Mock; upsertMany: jest.Mock };
  let service: AlertRoutingsService;

  beforeEach(() => {
    alertRoutingAccessor = { listBySpace: jest.fn(), upsertMany: jest.fn() };
    service = new AlertRoutingsService(alertRoutingAccessor as never);
  });

  it('returns the full six-cell matrix, all defaults, when the space has no stored rows', async () => {
    alertRoutingAccessor.listBySpace.mockResolvedValue([]);

    const result = await service.findAll(spaceId);

    expect(alertRoutingAccessor.listBySpace).toHaveBeenCalledWith(spaceId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toEqual([
        { alertType: 'intruder', channel: 'call', enabled: false },
        { alertType: 'intruder', channel: 'whatsapp', enabled: false },
        { alertType: 'intruder', channel: 'email', enabled: true },
        { alertType: 'suspicious', channel: 'call', enabled: false },
        { alertType: 'suspicious', channel: 'whatsapp', enabled: false },
        { alertType: 'suspicious', channel: 'email', enabled: true },
      ]);
    }
  });

  it('lets a stored enabled value override its default', async () => {
    alertRoutingAccessor.listBySpace.mockResolvedValue([
      buildRow({ alertType: 'intruder', channel: 'call', enabled: true }),
    ]);

    const result = await service.findAll(spaceId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const cell = result.data.items.find(
        (item) => item.alertType === 'intruder' && item.channel === 'call',
      );
      expect(cell?.enabled).toBe(true);
    }
  });

  it('forwards exactly dto.items to upsertMany and answers with the re-read matrix', async () => {
    const items = [
      {
        alertType: 'intruder' as const,
        channel: 'call' as const,
        enabled: true,
      },
    ];
    alertRoutingAccessor.upsertMany.mockResolvedValue([]);
    alertRoutingAccessor.listBySpace.mockResolvedValue([
      buildRow({ alertType: 'intruder', channel: 'call', enabled: true }),
    ]);

    const result = await service.replace(spaceId, { items });

    expect(alertRoutingAccessor.upsertMany).toHaveBeenCalledWith(
      spaceId,
      items,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(6);
    }
  });
});
