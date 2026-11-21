import { Request, Response } from 'express';
import { buildPrincipal } from '../../cross/common/jwt-payload.fixture';
import { buildData } from '../../cross/errors/either';
import { InvitationsController } from './invitations.controller';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };
const CLAIMS = {
  sub: 2,
  email: 'member@example.com',
  spaceId: null,
  profileCompleted: true,
};

describe('InvitationsController', () => {
  let invitationsService: Record<string, jest.Mock>;
  let refreshCookie: { replaceSession: jest.Mock };
  let controller: InvitationsController;

  const admin = buildPrincipal({ sub: 1, spaceId: 'space-1' });

  beforeEach(() => {
    invitationsService = {
      create: jest.fn().mockResolvedValue(buildData({ id: 'invitation-1' })),
      findPending: jest.fn().mockResolvedValue(buildData({ items: [] })),
      revoke: jest.fn().mockResolvedValue(buildData(null)),
      resend: jest.fn().mockResolvedValue(buildData({ id: 'invitation-1' })),
      preview: jest.fn().mockResolvedValue(buildData({ id: 'invitation-1' })),
      findMine: jest.fn().mockResolvedValue(buildData([])),
      accept: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      decline: jest.fn().mockResolvedValue(buildData(null)),
    };
    refreshCookie = {
      replaceSession: jest
        .fn()
        .mockResolvedValue(buildData({ accessToken: 'atoken' })),
    };
    controller = new InvitationsController(
      invitationsService as never,
      refreshCookie as never,
    );
  });

  it('creates the invitation for the caller space with the caller as inviter', async () => {
    const dto = { email: 'member@example.com', role: 'guest' as const };

    await controller.create(admin, dto);

    expect(invitationsService.create).toHaveBeenCalledWith('space-1', 1, dto);
  });

  it('scopes list, revoke and resend to the caller space', async () => {
    await controller.findPending(admin);
    await controller.revoke(admin, 'invitation-1');
    await controller.resend(admin, 'invitation-1');

    expect(invitationsService.findPending).toHaveBeenCalledWith('space-1');
    expect(invitationsService.revoke).toHaveBeenCalledWith(
      'space-1',
      'invitation-1',
    );
    expect(invitationsService.resend).toHaveBeenCalledWith(
      'space-1',
      'invitation-1',
    );
  });

  it('previews by token and lists the caller inbox by email', async () => {
    await controller.preview({ token: 'raw-token' });
    await controller.mine(CLAIMS);

    expect(invitationsService.preview).toHaveBeenCalledWith('raw-token');
    expect(invitationsService.findMine).toHaveBeenCalledWith(
      'member@example.com',
    );
  });

  it('accepts and swaps the session, returning only the access token', async () => {
    const req = {} as Request;
    const res = {} as Response;

    const result = await controller.accept(
      CLAIMS,
      'invitation-1',
      CONTEXT,
      req,
      res,
    );

    expect(invitationsService.accept).toHaveBeenCalledWith(
      CLAIMS,
      'invitation-1',
      CONTEXT,
    );
    expect(refreshCookie.replaceSession).toHaveBeenCalledWith(
      req,
      res,
      buildData(TOKEN_PAIR),
    );
    expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
  });

  it('declines on behalf of the caller', async () => {
    await controller.decline(CLAIMS, 'invitation-1');

    expect(invitationsService.decline).toHaveBeenCalledWith(
      CLAIMS,
      'invitation-1',
    );
  });
});
