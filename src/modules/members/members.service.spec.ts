import { SpaceMemberRosterRecord } from '../../data/accessors/space-member.accessor';
import { DEFAULT_MENU_ACCESS } from '../../cross/common/permissions';
import { MembersService } from './members.service';

function buildUser(
  overrides: Partial<SpaceMemberRosterRecord['user']> = {},
): SpaceMemberRosterRecord['user'] {
  return {
    id: 1,
    email: 'member@example.com',
    firstName: 'Ana',
    lastName: 'Gomez',
    phone: '+5491122334455',
    avatarUrl: null,
    isActive: true,
    lastLoginAt: null,
    profileCompleted: true,
    ...overrides,
  };
}

function buildMember(
  user: Partial<SpaceMemberRosterRecord['user']> = {},
  receiveAlerts = true,
): SpaceMemberRosterRecord {
  return {
    receiveAlerts,
    role: 'collaborator',
    menuAccess: ['home'],
    cameraIds: [],
    user: buildUser(user),
  };
}

describe('MembersService', () => {
  const spaceId = 'space-uuid';

  let spaceMemberAccessor: {
    listBySpace: jest.Mock;
    findBySpaceAndUser: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let cameraAccessor: { findAll: jest.Mock };
  let service: MembersService;

  beforeEach(() => {
    spaceMemberAccessor = {
      listBySpace: jest.fn(),
      findBySpaceAndUser: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    cameraAccessor = { findAll: jest.fn() };
    service = new MembersService(
      spaceMemberAccessor as never,
      cameraAccessor as never,
    );
  });

  it('passes the spaceId through to listBySpace', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([]);

    await service.findAll(spaceId, true);

    expect(spaceMemberAccessor.listBySpace).toHaveBeenCalledWith(spaceId);
  });

  it('maps every column, including a null avatarUrl and lastLoginAt', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({
        id: 1,
        email: 'member@example.com',
        firstName: 'Ana',
        lastName: 'Gomez',
        phone: '+5491122334455',
        avatarUrl: null,
        isActive: true,
        lastLoginAt: null,
      }),
    ]);

    const result = await service.findAll(spaceId, true);

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
        profileCompleted: true,
        receiveAlerts: true,
        role: 'collaborator',
        menuAccess: ['home'],
        cameraIds: [],
      });
    }
  });

  it('omits menuAccess and cameraIds but keeps role for a non-admin caller', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([buildMember()]);

    const result = await service.findAll(spaceId, false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.data.items[0];
      expect(row.role).toBe('collaborator');
      expect(row).not.toHaveProperty('menuAccess');
      expect(row).not.toHaveProperty('cameraIds');
    }
  });

  it('serves an invited member that has not completed its profile', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({
        firstName: '',
        lastName: '',
        phone: '',
        profileCompleted: false,
      }),
    ]);

    const result = await service.findAll(spaceId, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[0]).toMatchObject({
        firstName: '',
        lastName: '',
        phone: '',
        profileCompleted: false,
      });
    }
  });

  it('sets total to the number of items', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({ id: 1 }),
      buildMember({ id: 2 }),
    ]);

    const result = await service.findAll(spaceId, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(result.data.items.length);
      expect(result.data.total).toBe(2);
    }
  });

  it('preserves the accessor order', async () => {
    spaceMemberAccessor.listBySpace.mockResolvedValue([
      buildMember({ id: 2, email: 'second@example.com' }),
      buildMember({ id: 1, email: 'first@example.com' }),
    ]);

    const result = await service.findAll(spaceId, true);

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

    const result = await service.findAll(spaceId, true);

    expect(result).toEqual({ ok: true, data: { items: [], total: 0 } });
  });

  describe('update', () => {
    const existing = { spaceId, userId: 2, role: 'guest' };

    beforeEach(() => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(existing);
      spaceMemberAccessor.update.mockResolvedValue(buildMember({ id: 2 }));
    });

    it('answers NOT_FOUND when the member is not in the caller space', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(null);

      const result = await service.update(spaceId, 1, 2, {
        receiveAlerts: false,
      });

      expect(result).toEqual({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Member 2 not found',
      });
      expect(spaceMemberAccessor.update).not.toHaveBeenCalled();
    });

    it('answers CONFLICT when an admin changes their own role', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({
        ...existing,
        userId: 1,
        role: 'admin',
      });

      const result = await service.update(spaceId, 1, 1, {
        role: 'collaborator',
      });

      expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(spaceMemberAccessor.update).not.toHaveBeenCalled();
    });

    it('lets an admin toggle their own alerts with the same role', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({
        ...existing,
        userId: 1,
        role: 'admin',
      });

      const result = await service.update(spaceId, 1, 1, {
        role: 'admin',
        receiveAlerts: false,
      });

      expect(result.ok).toBe(true);
      expect(spaceMemberAccessor.update).toHaveBeenCalledWith(spaceId, 1, {
        receiveAlerts: false,
      });
    });

    it('resets the menu to the new role defaults when only the role changes', async () => {
      await service.update(spaceId, 1, 2, { role: 'collaborator' });

      expect(spaceMemberAccessor.update).toHaveBeenCalledWith(spaceId, 2, {
        role: 'collaborator',
        menuAccess: DEFAULT_MENU_ACCESS.collaborator,
      });
    });

    it('keeps an explicit menuAccess over the role defaults', async () => {
      await service.update(spaceId, 1, 2, {
        role: 'collaborator',
        menuAccess: ['home'],
      });

      expect(spaceMemberAccessor.update).toHaveBeenCalledWith(spaceId, 2, {
        role: 'collaborator',
        menuAccess: ['home'],
      });
    });

    it('rejects cameraIds that are not cameras of the space', async () => {
      cameraAccessor.findAll.mockResolvedValue([{ id: 'a' }]);

      const result = await service.update(spaceId, 1, 2, {
        cameraIds: ['a', 'b'],
      });

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
      expect(cameraAccessor.findAll).toHaveBeenCalledWith(spaceId, ['a', 'b']);
      expect(spaceMemberAccessor.update).not.toHaveBeenCalled();
    });

    it('stores cameraIds that all belong to the space', async () => {
      cameraAccessor.findAll.mockResolvedValue([{ id: 'a' }]);

      await service.update(spaceId, 1, 2, { cameraIds: ['a'] });

      expect(spaceMemberAccessor.update).toHaveBeenCalledWith(spaceId, 2, {
        cameraIds: ['a'],
      });
    });

    it('skips the camera lookup for an empty cameraIds', async () => {
      await service.update(spaceId, 1, 2, { cameraIds: [] });

      expect(cameraAccessor.findAll).not.toHaveBeenCalled();
      expect(spaceMemberAccessor.update).toHaveBeenCalledWith(spaceId, 2, {
        cameraIds: [],
      });
    });
  });

  describe('remove', () => {
    it('answers CONFLICT for a self removal before any lookup', async () => {
      const result = await service.remove(spaceId, 1, 1);

      expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(spaceMemberAccessor.findBySpaceAndUser).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for an unknown member', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(null);

      const result = await service.remove(spaceId, 1, 2);

      expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(spaceMemberAccessor.remove).not.toHaveBeenCalled();
    });

    it('removes the membership', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({ userId: 2 });

      const result = await service.remove(spaceId, 1, 2);

      expect(result).toEqual({ ok: true, data: null });
      expect(spaceMemberAccessor.remove).toHaveBeenCalledWith(spaceId, 2);
    });
  });
});
