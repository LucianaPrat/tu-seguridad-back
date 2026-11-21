import { AxiosError, AxiosHeaders } from 'axios';
import { from, of, throwError } from 'rxjs';
import { ErrorCode } from '../../cross/common/constants';
import { FaceAuthClientService } from './face-auth-client.service';

const SECRET_TOKEN = 'super-secret-fa-client-token-do-not-leak';
const SESSION_TOKEN = 'session-token-handed-out-by-authorize';

const EMPTY_DETECTION = {
  personsDetected: false,
  imageWidth: 0,
  imageHeight: 0,
  persons: [],
};

describe('FaceAuthClientService', () => {
  let httpService: { post: jest.Mock };
  let configService: { get: jest.Mock };
  let service: FaceAuthClientService;

  beforeEach(() => {
    httpService = { post: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          FACE_AUTH_API_URL: 'https://api.face-auth.me',
          FACE_AUTH_DOMAIN: 'test-domain',
          FACE_AUTH_CLIENT_TOKEN: SECRET_TOKEN,
          DETECT_TIMEOUT_MS: 10000,
        };
        return values[key];
      }),
    };
    service = new FaceAuthClientService(
      httpService as never,
      configService as never,
    );
  });

  /**
   * Two upstream calls now stand behind one `detectPersons`: the client token
   * is exchanged at `/auth/authorize`, and only what comes back is accepted by
   * `/persons`. Routing the mock by URL keeps every case honest about which of
   * the two it is exercising.
   */
  function respondTo(detect: unknown, authorize?: unknown): void {
    httpService.post.mockImplementation((url: string) =>
      url.endsWith('/auth/authorize')
        ? (authorize ?? of({ data: { isAuth: true, token: SESSION_TOKEN } }))
        : detect,
    );
  }

  type PostCall = [
    string,
    unknown,
    { headers: Record<string, string>; timeout: number },
  ];

  function postCalls(): PostCall[] {
    return httpService.post.mock.calls as PostCall[];
  }

  const isAuthorize = (call: PostCall): boolean =>
    call[0].endsWith('/auth/authorize');

  function detectCalls(): PostCall[] {
    return postCalls().filter((call) => !isAuthorize(call));
  }

  function axiosError(overrides: Partial<AxiosError>): AxiosError {
    const error = new AxiosError(
      overrides.message ?? 'Request failed',
      overrides.code,
      undefined,
      undefined,
      overrides.response as never,
    );
    return Object.assign(error, overrides);
  }

  it('maps a successful response to buildData', async () => {
    const payload = {
      personsDetected: true,
      imageWidth: 1280,
      imageHeight: 720,
      persons: [
        {
          detScore: 0.91,
          bbox: {
            topLeft: { x: 417, y: 163 },
            bottomRight: { x: 596, y: 682 },
          },
          bboxNorm: {
            topLeft: { x: 0.32, y: 0.22 },
            bottomRight: { x: 0.46, y: 0.94 },
          },
          anchor: { x: 0.396, y: 0.947 },
        },
      ],
    };
    respondTo(of({ data: payload }));

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toEqual({ ok: true, data: payload });
  });

  /**
   * The pipeline reads `detScore` and `anchor` and nothing else, so those two
   * are what a changed contract has to fail on. Left untyped, a dropped
   * `anchor` reaches `toPercentPoint` as `undefined` and the camera silently
   * stops alerting instead of reporting an upstream that changed under it.
   */
  it('refuses a body whose persons lost the anchor', async () => {
    respondTo(
      of({
        data: {
          personsDetected: true,
          imageWidth: 1280,
          imageHeight: 720,
          persons: [
            {
              detScore: 0.91,
              bbox: {
                topLeft: { x: 417, y: 163 },
                bottomRight: { x: 596, y: 682 },
              },
              bboxNorm: {
                topLeft: { x: 0.32, y: 0.22 },
                bottomRight: { x: 0.46, y: 0.94 },
              },
            },
          ],
        },
      }),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  it('accepts an empty persons array — a frame with nobody in it', async () => {
    respondTo(of({ data: EMPTY_DETECTION }));

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toEqual({ ok: true, data: EMPTY_DETECTION });
  });

  it('exchanges the client token and sends only what came back as Fa-Token', async () => {
    respondTo(of({ data: EMPTY_DETECTION }));

    await service.detectPersons(Buffer.from('img'), 'a.jpg');

    const [authorizeUrl, , authorizeOptions] = postCalls()[0];
    expect(authorizeUrl).toBe('https://api.face-auth.me/api/v1/auth/authorize');
    expect(authorizeOptions.headers['Fa-Client-Token']).toBe(SECRET_TOKEN);
    expect(authorizeOptions.headers['Fa-Domain']).toBe('test-domain');

    const [detectUrl, , options] = detectCalls()[0];
    expect(detectUrl).toBe('https://api.face-auth.me/api/v1/persons');
    expect(options.headers['Fa-Domain']).toBe('test-domain');
    // The client token is not a credential any protected endpoint accepts;
    // sending it directly is what answered 403 on every call.
    expect(options.headers['Fa-Token']).toBe(SESSION_TOKEN);
    expect(options.headers['Fa-Token']).not.toBe(SECRET_TOKEN);
    expect(options.timeout).toBe(10000);
  });

  it('re-authorizes once and retries when the session token is rejected', async () => {
    let attempt = 0;
    httpService.post.mockImplementation((url: string) => {
      if (url.endsWith('/auth/authorize')) {
        return of({ data: { isAuth: true, token: SESSION_TOKEN } });
      }
      attempt += 1;
      return attempt === 1
        ? throwError(() =>
            axiosError({
              message: 'Request failed with status code 403',
              response: {
                status: 403,
                statusText: 'Forbidden',
                data: {},
                headers: new AxiosHeaders(),
                config: { headers: new AxiosHeaders() } as never,
              },
            }),
          )
        : of({ data: EMPTY_DETECTION });
    });

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: true });
    expect(detectCalls()).toHaveLength(2);
  });

  it('gives up instead of looping when the fresh token is refused too', async () => {
    const forbidden = () =>
      throwError(() =>
        axiosError({
          message: 'Request failed with status code 403',
          response: {
            status: 403,
            statusText: 'Forbidden',
            data: {},
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() } as never,
          },
        }),
      );
    respondTo(forbidden());

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
    expect(detectCalls()).toHaveLength(2);
  });

  it('reuses the session token instead of authorizing on every frame', async () => {
    respondTo(of({ data: EMPTY_DETECTION }));

    await service.detectPersons(Buffer.from('img'), 'a.jpg');
    await service.detectPersons(Buffer.from('img'), 'b.jpg');

    expect(postCalls().filter(isAuthorize)).toHaveLength(1);
    expect(detectCalls()).toHaveLength(2);
  });

  it('authorizes once when several frames arrive on a cold cache', async () => {
    // The poll runs cameras in parallel, so a cold cache is hit by a whole
    // batch at once. An authorize that does not settle synchronously is what
    // makes the second caller arrive before the first has cached anything.
    respondTo(
      of({ data: EMPTY_DETECTION }),
      from(
        new Promise((resolve) =>
          setImmediate(() =>
            resolve({ data: { isAuth: true, token: SESSION_TOKEN } }),
          ),
        ),
      ),
    );

    await Promise.all([
      service.detectPersons(Buffer.from('img'), 'a.jpg'),
      service.detectPersons(Buffer.from('img'), 'b.jpg'),
    ]);

    expect(postCalls().filter(isAuthorize)).toHaveLength(1);
    expect(detectCalls()).toHaveLength(2);
  });

  it('refuses an authorize answer that carries no session token', async () => {
    respondTo(
      of({ data: EMPTY_DETECTION }),
      of({ data: { isAuth: true, token: '' } }),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
    expect(detectCalls()).toHaveLength(0);
  });

  it('maps a timeout to UPSTREAM_TIMEOUT without leaking the token', async () => {
    respondTo(
      throwError(() =>
        axiosError({
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        }),
      ),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
    if (!result.ok) {
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  it('maps a 500 to UPSTREAM_ERROR without leaking the token', async () => {
    respondTo(
      throwError(() =>
        axiosError({
          message: 'Request failed with status code 500',
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            data: {},
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() } as never,
          },
        }),
      ),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
    if (!result.ok) {
      expect(result.message).toContain('500');
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  /** A `429`, optionally carrying the header this upstream does not document. */
  function throttled(retryAfter?: string) {
    const headers = new AxiosHeaders();
    if (retryAfter !== undefined) {
      headers.set('retry-after', retryAfter);
    }
    return throwError(() =>
      axiosError({
        message: 'Request failed with status code 429',
        response: {
          status: 429,
          statusText: 'Too Many Requests',
          data: {},
          headers,
          config: { headers: new AxiosHeaders() } as never,
        },
      }),
    );
  }

  it('maps a 429 to UPSTREAM_THROTTLED without leaking the token', async () => {
    respondTo(throttled());

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_THROTTLED,
    });
    if (!result.ok) {
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  it('parks the next call instead of spending it on a throttled upstream', async () => {
    respondTo(throttled('5'));
    await service.detectPersons(Buffer.from('img'), 'a.jpg');

    httpService.post.mockClear();
    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(httpService.post).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_THROTTLED,
    });
  });

  it('honours Retry-After and calls again once it has elapsed', async () => {
    jest.useFakeTimers();
    service = new FaceAuthClientService(
      httpService as never,
      configService as never,
    );
    try {
      respondTo(throttled('5'));
      await service.detectPersons(Buffer.from('img'), 'a.jpg');

      jest.advanceTimersByTime(4000);
      httpService.post.mockClear();
      await service.detectPersons(Buffer.from('img'), 'a.jpg');
      expect(httpService.post).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1500);
      respondTo(of({ data: EMPTY_DETECTION }));
      const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

      expect(httpService.post).toHaveBeenCalled();
      expect(result).toMatchObject({ ok: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the circuit closed through a throttle burst', async () => {
    // Ten `429`s that actually reach the upstream — the clock is advanced past
    // each park so none of them is short-circuited locally. Twice what a run of
    // 500s needs to open the breaker, and it must stay closed: a throttle is
    // not an outage, and opening here would stop detection on every camera for
    // the whole reset window.
    jest.useFakeTimers();
    service = new FaceAuthClientService(
      httpService as never,
      configService as never,
    );
    try {
      respondTo(throttled('1'));
      for (let i = 0; i < 10; i++) {
        const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');
        expect(result).toMatchObject({ code: ErrorCode.UPSTREAM_THROTTLED });
        jest.advanceTimersByTime(1500);
      }

      expect(service.circuitState).toBe('closed');
      expect(httpService.post).toHaveBeenCalledTimes(11);
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps a non-axios error to UPSTREAM_ERROR', async () => {
    respondTo(throwError(() => new Error('boom')));

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  async function driveOpen(): Promise<void> {
    respondTo(throwError(() => new Error('boom')));
    for (let i = 0; i < 5; i++) {
      await service.detectPersons(Buffer.from('img'), 'a.jpg');
    }
  }

  it('opens the circuit after repeated upstream failures', async () => {
    await driveOpen();

    expect(service.circuitState).toBe('open');
  });

  it('short-circuits without calling the upstream once open', async () => {
    await driveOpen();
    expect(service.circuitState).toBe('open');

    httpService.post.mockClear();
    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(httpService.post).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
    });
    if (!result.ok) {
      expect(result.message).toBe('face-auth circuit open');
    }
  });

  it('attempts a single probe call after the reset timeout (half-open)', async () => {
    jest.useFakeTimers();
    service = new FaceAuthClientService(
      httpService as never,
      configService as never,
    );
    try {
      await driveOpen();
      expect(service.circuitState).toBe('open');

      jest.advanceTimersByTime(30000);
      expect(service.circuitState).toBe('halfOpen');

      httpService.post.mockClear();
      respondTo(of({ data: EMPTY_DETECTION }));
      const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

      // One probe, not two: the session token survived the open circuit, so
      // the half-open call spends its single attempt on detection.
      expect(httpService.post).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
