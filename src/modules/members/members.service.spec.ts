import { SpaceMember, User } from '@prisma/client';
import { MembersService } from './members.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'member@example.com',
    passwordHash: 'hash',
    firstName: 'Ana',
    lastName: 'Gomez',
    phone: '+5491122334455',
    avatarUrl: null,
    isActive: true,
    lastLoginAt: null,
    profileCompleted: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildMember(
  overrides: Partial<SpaceMember> = {},
  user: Partial<User> = {},
): SpaceMember & { user: User } {
  return {
    id: 'member-uuid',
    spaceId: 'space-uuid',
    userId: 1,
    role: 'member',
    receiveAlerts: true,
    invitedByUserId: null,
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
    user: buildUser({ id: overrides.userId ?? 1, ...user }),
  };
}

describe('MembersService', () => {
  const spaceId = 'space-uuid';

  let spaceMemberAccessor: { listBySpace: jest.Mock };
  let service: MembersService;

  beforeEach(() => {
    spaceMemberAccessor = { listBySpace: jest.fn() };
    service = new MembersService(spaceMemberAccessor as never);
  });

  it('passes the spaceId through to listBySpace', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([]);

    await service.findAll(spaceId);

    expect(spaceMemberAccessor.listBySpace).toHaveBeenCalledWith(spaceId);
  });

  it('maps every column, including a null avatarUrl and lastLoginAt', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember(
        {},
        {
          id: 1,
          email: 'member@example.com',
          firstName: 'Ana',
          lastName: 'Gomez',
          phone: '+5491122334455',
          avatarUrl: null,
          isActive: true,
          lastLoginAt: null,
        },
      ),
    ]);

    const result = await service.findAll(spaceId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[0]).toEqual({
        id: 1,
        email: 'member@example.com',
        firstName: 'Ana',
        lastName: 'Gomez',
        phone: '+5491122334455',
        avatarUrl: null,
        isActive: true,
        lastLoginAt: null,
      });
    }
  });

  it('sets total to the number of items', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({ userId: 1 }),
      buildMember({ userId: 2 }),
    ]);

    const result = await service.findAll(spaceId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(result.data.items.length);
      expect(result.data.total).toBe(2);
    }
  });

  it('preserves the accessor order', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({ userId: 2 }, { id: 2, email: 'second@example.com' }),
      buildMember({ userId: 1 }, { id: 1, email: 'first@example.com' }),
    ]);

    const result = await service.findAll(spaceId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items.map((item) => item.email)).toEqual([
        'second@example.com',
        'first@example.com',
      ]);
    }
  });

  it('returns an empty roster for a space with no members', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([]);

    const result = await service.findAll(spaceId);

    expect(result).toEqual({ ok: true, data: { items: [], total: 0 } });
  });
});
