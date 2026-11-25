import { buildPrincipal } from '../../cross/common/jwt-payload.fixture';
import { ROLES_KEY } from '../../cross/decorators/roles.decorator';
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
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let activityService: { getActivity: jest.Mock };
  let controller: MembersController;

  beforeEach(() => {
    membersService = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    activityService = { getActivity: jest.fn() };
    controller = new MembersController(
      membersService as never,
      activityService as never,
    );
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

  it('restricts the activity route to admins', () => {
    // Metadata lives on the prototype method; it is read, never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const handler = MembersController.prototype.activity;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin']);
  });

  it('delegates activity with the caller space and window', async () => {
    await controller.activity(user, { days: 90 });
    expect(activityService.getActivity).toHaveBeenCalledWith('space-uuid', 90);
  });

  it('delegates create with the caller space, caller id and body', async () => {
    const dto = { email: 'new@example.com', role: 'guest' as const };
    await controller.create(user, dto);
    expect(membersService.create).toHaveBeenCalledWith('space-uuid', 1, dto);
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
