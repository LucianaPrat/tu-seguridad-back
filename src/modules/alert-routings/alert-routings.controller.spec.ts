import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { AlertRoutingsController } from './alert-routings.controller';
import { AlertRoutingListDto } from './dto/alert-routing-list.dto';

describe('AlertRoutingsController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let alertRoutingsService: { findAll: jest.Mock; replace: jest.Mock };
  let controller: AlertRoutingsController;

  beforeEach(() => {
    alertRoutingsService = { findAll: jest.fn(), replace: jest.fn() };
    controller = new AlertRoutingsController(alertRoutingsService as never);
  });

  it('delegates findAll with the caller space', async () => {
    await controller.findAll(user);
    expect(alertRoutingsService.findAll).toHaveBeenCalledWith('space-uuid');
  });

  it('delegates replace with the caller space and the body', async () => {
    const dto: AlertRoutingListDto = {
      items: [{ alertType: 'intruder', channel: 'call', enabled: true }],
    };

    await controller.replace(user, dto);

    expect(alertRoutingsService.replace).toHaveBeenCalledWith(
      'space-uuid',
      dto,
    );
  });
});
