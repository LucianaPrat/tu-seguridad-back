import { ExecutionContext } from '@nestjs/common';
import { EventEmitter } from 'events';
import { of } from 'rxjs';
import { HitInterceptor } from './hit.interceptor';
import { RequestWithUser } from '../guards/jwt-auth.guard';

describe('HitInterceptor', () => {
  let hitAccessor: { create: jest.Mock };
  let httpDuration: { observe: jest.Mock };
  let interceptor: HitInterceptor;

  beforeEach(() => {
    hitAccessor = { create: jest.fn().mockResolvedValue({}) };
    httpDuration = { observe: jest.fn() };
    interceptor = new HitInterceptor(
      hitAccessor as never,
      httpDuration as never,
    );
  });

  function contextFor(
    request: Partial<RequestWithUser>,
    response: EventEmitter & { statusCode: number },
  ): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  function fakeResponse(
    statusCode: number,
  ): EventEmitter & { statusCode: number } {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
    };
    response.statusCode = statusCode;
    return response;
  }

  it('records one hit per request, including the authenticated user id', async () => {
    const request: Partial<RequestWithUser> = {
      method: 'GET',
      path: '/api/v1/cameras',
      user: { sub: 42, email: 'a@a.com', role: 'admin' },
    };
    const response = fakeResponse(200);
    const handler = { handle: () => of('ok') };

    interceptor.intercept(contextFor(request, response), handler).subscribe();
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(hitAccessor.create).toHaveBeenCalledTimes(1);
    expect(hitAccessor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        route: '/api/v1/cameras',
        statusCode: 200,
        userId: 42,
        isError: false,
      }),
    );
    expect(httpDuration.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        route: '/api/v1/cameras',
        status: '200',
      }),
      expect.any(Number),
    );
  });

  it('marks 4xx/5xx responses as isError', async () => {
    const request: Partial<RequestWithUser> = {
      method: 'POST',
      path: '/api/v1/cameras',
    };
    const response = fakeResponse(404);
    const handler = { handle: () => of('err') };

    interceptor.intercept(contextFor(request, response), handler).subscribe();
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(hitAccessor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        isError: true,
        userId: undefined,
      }),
    );
  });

  it('skips /health and /docs paths entirely', async () => {
    const request: Partial<RequestWithUser> = {
      method: 'GET',
      path: '/health/live',
    };
    const response = fakeResponse(200);
    const handler = { handle: () => of('ok') };

    interceptor.intercept(contextFor(request, response), handler).subscribe();
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(hitAccessor.create).not.toHaveBeenCalled();
  });

  it('does not break the response when the sink fails', async () => {
    hitAccessor.create.mockRejectedValue(new Error('db down'));
    const request: Partial<RequestWithUser> = {
      method: 'GET',
      path: '/api/v1/cameras',
    };
    const response = fakeResponse(200);
    const handler = { handle: () => of('ok') };

    let emitted: unknown;
    interceptor
      .intercept(contextFor(request, response), handler)
      .subscribe((value) => (emitted = value));
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(emitted).toBe('ok');
  });
});
