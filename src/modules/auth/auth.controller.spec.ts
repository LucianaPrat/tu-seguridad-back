import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let authService: { login: jest.Mock; refresh: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    authService = { login: jest.fn(), refresh: jest.fn() };
    controller = new AuthController(authService as never);
  });

  it('delegates login to AuthService with the dto fields', async () => {
    authService.login.mockResolvedValue({ ok: true, data: {} });

    await controller.login({ email: 'a@a.com', password: 'secret' });

    expect(authService.login).toHaveBeenCalledWith('a@a.com', 'secret');
  });

  it('delegates refresh to AuthService with the refresh token', async () => {
    authService.refresh.mockResolvedValue({ ok: true, data: {} });

    await controller.refresh({ refreshToken: 'rtoken' });

    expect(authService.refresh).toHaveBeenCalledWith('rtoken');
  });
});
