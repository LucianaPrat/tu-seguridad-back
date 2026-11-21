import { HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';
import { FaceAuthHealthIndicator } from './face-auth.health-indicator';

describe('FaceAuthHealthIndicator', () => {
  let http: { get: jest.Mock };
  let config: { get: jest.Mock };
  let indicator: FaceAuthHealthIndicator;

  beforeEach(() => {
    http = { get: jest.fn() };
    config = { get: jest.fn().mockReturnValue('https://api.face-auth.me') };
    indicator = new FaceAuthHealthIndicator(
      http as never,
      config as never,
      new HealthIndicatorService(),
    );
  });

  it('reports up when the upstream responds at all', async () => {
    http.get.mockReturnValue(of({ status: 200 }));

    const result = await indicator.isHealthy('face-auth');

    expect(result).toEqual({ 'face-auth': { status: 'up' } });
  });

  it('reports down when the upstream is unreachable', async () => {
    http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    const result = await indicator.isHealthy('face-auth');

    expect(result).toEqual({
      'face-auth': { status: 'down', message: 'ECONNREFUSED' },
    });
  });
});
