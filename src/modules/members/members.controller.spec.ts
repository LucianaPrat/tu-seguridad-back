import { buildPrincipal } from '../../cross/common/jwt-payload.fixture';
import { MembersController } from './members.controller';

describe('MembersController', () => {
  const user = buildPrincipal({
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  });

  let membersService: {
    findAll: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let controller: MembersController;

  beforeEach(() => {
    membersService = {
      findAll: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new MembersController(membersService as never);
  });

  it('delegates findAll with permissions for an admin', async () => {
    await controller.findAll(user);
    expect(membersService.findAll).toHaveBeenCalledWith('space-uuid', true);
  });

  it('delegates findAll without permissions for a non-admin', async () => {
    await controller.findAll(buildPrincipal({ role: 'collaborator' }));
    expect(membersService.findAll).toHaveBeenCalledWith(
      expect.any(String),
      false,
    );
  });

  it('delegates update with the caller space, caller id, target user and body', async () => {
    await controller.update(user, 2, { receiveAlerts: false });
    expect(membersService.update).toHaveBeenCalledWith('space-uuid', 1, 2, {
      receiveAlerts: false,
    });
  });

  it('delegates remove with the caller space, caller id and target user', async () => {
    await controller.remove(user, 2);
    expect(membersService.remove).toHaveBeenCalledWith('space-uuid', 1, 2);
  });
});
