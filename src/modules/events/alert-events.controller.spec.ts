import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { AlertEventsController } from './alert-events.controller';

describe('AlertEventsController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'admin@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let alertEventsService: {
    query: jest.Mock;
    findById: jest.Mock;
    findDeliveries: jest.Mock;
    acknowledgeInbound: jest.Mock;
  };
  let controller: AlertEventsController;

  beforeEach(() => {
    alertEventsService = {
      query: jest.fn(),
      findById: jest.fn(),
      findDeliveries: jest.fn(),
      acknowledgeInbound: jest.fn(),
    };
    controller = new AlertEventsController(alertEventsService as never);
  });

  it('delegates the history query with the caller space', async () => {
    await controller.query(user, { alertType: 'intruder' });
    expect(alertEventsService.query).toHaveBeenCalledWith('space-uuid', {
      alertType: 'intruder',
    });
  });

  it('delegates findOne with the caller space', async () => {
    await controller.findOne(user, 'event-1');
    expect(alertEventsService.findById).toHaveBeenCalledWith(
      'space-uuid',
      'event-1',
    );
  });

  it('delegates the delivery list with the caller space', async () => {
    await controller.findDeliveries(user, 'event-1');
    expect(alertEventsService.findDeliveries).toHaveBeenCalledWith(
      'space-uuid',
      'event-1',
    );
  });

  it('delegates an inbound acknowledgement by correlation id alone', async () => {
    await controller.acknowledge({ correlationId: 'correlation-1' });
    expect(alertEventsService.acknowledgeInbound).toHaveBeenCalledWith(
      'correlation-1',
    );
  });
});
