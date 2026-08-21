import { Response } from 'express';
import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { buildData, Either } from '../../cross/errors/either';
import { InvitationsController } from './invitations.controller';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };

describe('InvitationsController', () => {
  let invitationsService: {
    create: jest.Mock;
    findPending: jest.Mock;
    accept: jest.Mock;
  };
  let refreshCookie: { issueSession: jest.Mock };
  let res: Response;
  let controller: InvitationsController;

  const admin: JwtPayload = {
    sub: 1,
    email: 'owner@example.com',
    spaceId: 'space-1',
    role: 'admin',
    profileCompleted: true,
  };

  beforeEach(() => {
    invitationsService = {
      create: jest.fn().mockResolvedValue(buildData({ id: 'invitation-1' })),
      findPending: jest
        .fn()
        .mockResolvedValue(buildData({ items: [], total: 0 })),
      accept: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
    };
    refreshCookie = {
      issueSession: jest
        .fn()
        .mockImplementation(
          (_res: Response, result: Either<typeof TOKEN_PAIR>) =>
            result.ok
              ? buildData({ accessToken: result.data.accessToken })
              : result,
        ),
    };
    res = {} as Response;
    controller = new InvitationsController(
      invitationsService as never,
      refreshCookie as never,
    );
  });

  it('creates the invitation for the caller space and the caller as inviter', async () => {
    await controller.create(admin, { email: 'member@example.com' });

    expect(invitationsService.create).toHaveBeenCalledWith(
      'space-1',
      1,
      'member@example.com',
    );
  });

  it('lists the pending invitations of the caller space', async () => {
    await controller.findPending(admin);

    expect(invitationsService.findPending).toHaveBeenCalledWith('space-1');
  });

  it('accepts a token and returns only the access token', async () => {
    const result = await controller.accept(
      { token: 'raw-token' },
      CONTEXT,
      res,
    );

    expect(invitationsService.accept).toHaveBeenCalledWith(
      'raw-token',
      CONTEXT,
    );
    expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
  });
});
