import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { MembersController } from './members.controller';

describe('MembersController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let membersService: { findAll: jest.Mock; setReceiveAlerts: jest.Mock };
  let controller: MembersController;

  beforeEach(() => {
    membersService = { findAll: jest.fn(), setReceiveAlerts: jest.fn() };
    controller = new MembersController(membersService as never);
  });

  it('delegates findAll with the caller space', async () => {
    await controller.findAll(user);
    expect(membersService.findAll).toHaveBeenCalledWith('space-uuid');
  });

  it('delegates setReceiveAlerts with the caller space, target user and body', async () => {
    await controller.setReceiveAlerts(user, 2, { receiveAlerts: false });
    expect(membersService.setReceiveAlerts).toHaveBeenCalledWith(
      'space-uuid',
      2,
      { receiveAlerts: false },
    );
  });
});
