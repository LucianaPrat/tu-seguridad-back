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

  // The credential the body carries is the service's to interpret: the route is
  // the same for a provider callback and for an emailed acknowledge link, and
  // deciding between them here would put that rule in two places.
  it.each([
    ['a provider correlation id', { correlationId: 'correlation-1' }],
    ['an emailed token', { token: 'delivery-1.signature' }],
  ])('passes %s through to the service untouched', async (_case, dto) => {
    await controller.acknowledge(dto);
    expect(alertEventsService.acknowledgeInbound).toHaveBeenCalledWith(dto);
  });
});
