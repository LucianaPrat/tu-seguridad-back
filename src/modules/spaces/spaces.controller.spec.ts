import { Request, Response } from 'express';
import { buildPrincipal } from '../../cross/common/jwt-payload.fixture';
import { buildData } from '../../cross/errors/either';
import { SpacesController } from './spaces.controller';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };

describe('SpacesController', () => {
  const claims = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid' as string | null,
    profileCompleted: true,
  };
  const req = { cookies: {} } as unknown as Request;
  const res = {} as Response;

  let spacesService: {
    list: jest.Mock;
    create: jest.Mock;
    rename: jest.Mock;
    remove: jest.Mock;
  };
  let refreshCookie: { replaceSession: jest.Mock };
  let controller: SpacesController;

  beforeEach(() => {
    spacesService = {
      list: jest.fn().mockResolvedValue(buildData([])),
      create: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      rename: jest.fn().mockResolvedValue(buildData({})),
      remove: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
    };
    refreshCookie = {
      replaceSession: jest
        .fn()
        .mockResolvedValue(buildData({ accessToken: 'atoken' })),
    };
    controller = new SpacesController(
      spacesService as never,
      refreshCookie as never,
    );
  });

  it('lists with the token claims', async () => {
    await controller.list(claims);

    expect(spacesService.list).toHaveBeenCalledWith(claims);
  });

  it('creates a space and replaces the session', async () => {
    const result = await controller.create(
      claims,
      { name: 'New' },
      CONTEXT,
      req,
      res,
    );

    expect(spacesService.create).toHaveBeenCalledWith(claims, 'New', CONTEXT);
    expect(refreshCookie.replaceSession).toHaveBeenCalledWith(
      req,
      res,
      buildData(TOKEN_PAIR),
    );
    expect(result).toEqual(buildData({ accessToken: 'atoken' }));
  });

  it('renames the current space of the principal', async () => {
    await controller.rename(buildPrincipal(), { name: 'Renamed' });

    expect(spacesService.rename).toHaveBeenCalledWith(
      'space-uuid',
      'admin',
      'Renamed',
    );
  });

  it('deletes the current space and replaces the session', async () => {
    const result = await controller.remove(buildPrincipal(), CONTEXT, req, res);

    expect(spacesService.remove).toHaveBeenCalledWith(1, 'space-uuid', CONTEXT);
    expect(result).toEqual(buildData({ accessToken: 'atoken' }));
  });
});
