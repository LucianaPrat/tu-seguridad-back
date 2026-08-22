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

  let membersService: { findAll: jest.Mock };
  let controller: MembersController;

  beforeEach(() => {
    membersService = { findAll: jest.fn() };
    controller = new MembersController(membersService as never);
  });

  it('delegates findAll with the caller space', async () => {
    await controller.findAll(user);
    expect(membersService.findAll).toHaveBeenCalledWith('space-uuid');
  });
});
