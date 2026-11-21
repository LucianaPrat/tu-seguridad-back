import { SpaceMember, User } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { SpacesService } from './spaces.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };

describe('SpacesService', () => {
  const claims = {
    sub: 1,
    email: 'owner@example.com',
    spaceId: 'space-1' as string | null,
    profileCompleted: true,
  };
  const user = { id: 1, isActive: true } as User;
  const member = {
    spaceId: 'space-2',
    userId: 1,
    role: 'admin',
  } as SpaceMember;

  let spaceAccessor: {
    createSpaceForUser: jest.Mock;
    rename: jest.Mock;
    deleteEmpty: jest.Mock;
  };
  let spaceMemberAccessor: { findManyByUserIdWithSpace: jest.Mock };
  let userAccessor: { findById: jest.Mock };
  let dvrAccessor: { findBySpaceId: jest.Mock };
  let sessionService: { issue: jest.Mock; loadActiveMembership: jest.Mock };
  let service: SpacesService;

  beforeEach(() => {
    spaceAccessor = {
      createSpaceForUser: jest
        .fn()
        .mockResolvedValue({ space: { id: 'space-2' }, member }),
      rename: jest.fn().mockResolvedValue({ id: 'space-1', name: 'Renamed' }),
      deleteEmpty: jest.fn().mockResolvedValue(undefined),
    };
    spaceMemberAccessor = {
      findManyByUserIdWithSpace: jest.fn().mockResolvedValue([
        { role: 'admin', space: { id: 'space-1', name: 'A' } },
        { role: 'guest', space: { id: 'space-3', name: 'B' } },
      ]),
    };
    userAccessor = { findById: jest.fn().mockResolvedValue(user) };
    dvrAccessor = { findBySpaceId: jest.fn().mockResolvedValue(null) };
    sessionService = {
      issue: jest.fn().mockResolvedValue(TOKEN_PAIR),
      loadActiveMembership: jest.fn().mockResolvedValue({ user, member: null }),
    };
    service = new SpacesService(
      spaceAccessor as never,
      spaceMemberAccessor as never,
      userAccessor as never,
      dvrAccessor as never,
      sessionService as never,
    );
  });

  it('lists the caller memberships as summaries', async () => {
    const result = await service.list(claims);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'space-1', name: 'A', role: 'admin' },
        { id: 'space-3', name: 'B', role: 'guest' },
      ],
    });
  });

  it('creates a space and issues a session in it', async () => {
    const result = await service.create(claims, 'New', CONTEXT);

    expect(spaceAccessor.createSpaceForUser).toHaveBeenCalledWith(1, 'New');
    expect(sessionService.issue).toHaveBeenCalledWith(user, member, CONTEXT);
    expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
  });

  it('renames the space and echoes the caller role', async () => {
    const result = await service.rename('space-1', 'admin', 'Renamed');

    expect(result).toEqual({
      ok: true,
      data: { id: 'space-1', name: 'Renamed', role: 'admin' },
    });
  });

  describe('remove', () => {
    it('returns CONFLICT while the space has a DVR', async () => {
      dvrAccessor.findBySpaceId.mockResolvedValue({ id: 'dvr-1' });

      const result = await service.remove(1, 'space-1', CONTEXT);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.CONFLICT,
        message: 'Remove the DVR before deleting the space',
      });
      expect(spaceAccessor.deleteEmpty).not.toHaveBeenCalled();
    });

    it('deletes the space and re-issues the session from the remaining membership', async () => {
      sessionService.loadActiveMembership.mockResolvedValue({ user, member });

      const result = await service.remove(1, 'space-1', CONTEXT);

      expect(spaceAccessor.deleteEmpty).toHaveBeenCalledWith('space-1');
      expect(sessionService.issue).toHaveBeenCalledWith(user, member, CONTEXT);
      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
    });

    it('still issues a session when no space is left', async () => {
      await service.remove(1, 'space-1', CONTEXT);

      expect(sessionService.issue).toHaveBeenCalledWith(user, null, CONTEXT);
    });
  });
});
