import { EventsController } from './events.controller';

describe('EventsController', () => {
  it('delegates query to EventsService with the query dto', async () => {
    const eventsService = { query: jest.fn() };
    const controller = new EventsController(eventsService as never);
    const dto = { cameraId: 'camera_01', limit: 10 };

    await controller.query(dto);

    expect(eventsService.query).toHaveBeenCalledWith(dto);
  });
});
