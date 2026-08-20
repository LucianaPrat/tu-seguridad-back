import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { DvrController } from './dvr.controller';

describe('DvrController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let dvrService: {
    findBySpace: jest.Mock;
    configure: jest.Mock;
    rediscover: jest.Mock;
    testConnection: jest.Mock;
  };
  let controller: DvrController;

  beforeEach(() => {
    dvrService = {
      findBySpace: jest.fn(),
      configure: jest.fn(),
      rediscover: jest.fn(),
      testConnection: jest.fn(),
    };
    controller = new DvrController(dvrService as never);
  });

  it('delegates findOne with the caller space', async () => {
    await controller.findOne(user);
    expect(dvrService.findBySpace).toHaveBeenCalledWith('space-uuid');
  });

  it('delegates configure', async () => {
    const dto = {
      url: 'http://192.168.1.10:8000',
      username: 'admin',
      password: 'dvr-password',
      timezone: 'UTC',
    };
    await controller.configure(user, dto);
    expect(dvrService.configure).toHaveBeenCalledWith('space-uuid', dto);
  });

  it('delegates rediscover', async () => {
    await controller.rediscover(user);
    expect(dvrService.rediscover).toHaveBeenCalledWith('space-uuid');
  });

  it('delegates testConnection with the body alone — a probe touches no space', async () => {
    const dto = {
      url: 'http://192.168.1.10:8000',
      username: 'admin',
      password: 'dvr-password',
    };
    await controller.testConnection(dto);
    expect(dvrService.testConnection).toHaveBeenCalledWith(dto);
  });
});
