import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { of, throwError } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { DvrEvent } from './dvr-client.port';
import { HttpDvrClientService } from './http-dvr-client.service';

const connection = {
  url: 'http://192.168.1.250/',
  username: 'admin',
  password: 'dvr-password',
};

const CHANNELS_URL = 'http://192.168.1.250/ISAPI/System/Video/inputs/channels';

/** Verbatim shape of what a DVR-208G-M1 on V4.71.410 answers 401 with. */
const CHALLENGE =
  'Digest realm="dvr-realm", domain="/", qop="auth", nonce="abc123", ' +
  'opaque="799d5", algorithm="MD5", stale="FALSE"';

/**
 * Real listing, trimmed to four ports: an empty socket, a wired one whose
 * `resDesc` arrives with the leading space the firmware emits, one named
 * through an XML entity, and one whose name the operator cleared.
 */
const CHANNELS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<VideoInputChannelList version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<VideoInputChannel version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>1</id>
<inputPort>1</inputPort>
<videoInputEnabled>true</videoInputEnabled>
<name>Camera 01</name>
<videoFormat>PAL</videoFormat>
<resDesc>NO VIDEO</resDesc>
</VideoInputChannel>
<VideoInputChannel version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>3</id>
<inputPort>3</inputPort>
<videoInputEnabled>true</videoInputEnabled>
<name>Camera 03</name>
<videoFormat>PAL</videoFormat>
<resDesc> 1280*720(HD720P)P25</resDesc>
</VideoInputChannel>
<VideoInputChannel version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>4</id>
<inputPort>4</inputPort>
<videoInputEnabled>true</videoInputEnabled>
<name>Patio &amp; Garage</name>
<videoFormat>PAL</videoFormat>
<resDesc>960*1080(1080PLite)P25</resDesc>
</VideoInputChannel>
<VideoInputChannel version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>8</id>
<inputPort>8</inputPort>
<videoInputEnabled>true</videoInputEnabled>
<name></name>
<videoFormat>PAL</videoFormat>
<resDesc>960*1080(1080PLite)P25</resDesc>
</VideoInputChannel>
</VideoInputChannelList>`;

const NOTIFICATIONS_URL =
  'http://192.168.1.250/ISAPI/Event/triggers/VMD-4/notifications';

/** Verbatim shape of a VMD trigger's notification list on V4.71.410. */
const NOTIFICATIONS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<EventTriggerNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<EventTriggerNotification>
<id>whiteLightOut-1</id>
<notificationMethod>whiteLightOut</notificationMethod>
<lightAudioOutID>1</lightAudioOutID>
</EventTriggerNotification>
<EventTriggerNotification>
<id>record-1</id>
<notificationMethod>record</notificationMethod>
<videoInputID>1</videoInputID>
</EventTriggerNotification>
</EventTriggerNotificationList>`;

/** The same list after a `center` linkage already took. */
const NOTIFICATIONS_XML_WITH_CENTER = `<?xml version="1.0" encoding="UTF-8" ?>
<EventTriggerNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<EventTriggerNotification>
<id>whiteLightOut-1</id>
<notificationMethod>whiteLightOut</notificationMethod>
<lightAudioOutID>1</lightAudioOutID>
</EventTriggerNotification>
<EventTriggerNotification>
<id>record-1</id>
<notificationMethod>record</notificationMethod>
<videoInputID>1</videoInputID>
</EventTriggerNotification>
<EventTriggerNotification>
<id>center</id>
<notificationMethod>center</notificationMethod>
</EventTriggerNotification>
</EventTriggerNotificationList>`;

/** What ISAPI answers a PUT with — accepted here, even where it silently drops an element. */
const RESPONSE_STATUS_OK = `<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<requestURL>/ISAPI/Event/triggers/VMD-4/notifications</requestURL>
<statusCode>1</statusCode>
<statusString>OK</statusString>
<subStatusCode>ok</subStatusCode>
</ResponseStatus>`;

const EVENT_STREAM_HEADERS = {
  'content-type': 'multipart/mixed; boundary=--boundary',
};

/** Verbatim idle heartbeat: a DVR-208G-M1 repeats this every ~9.5s. */
const HEARTBEAT_ALERT = `<EventNotificationAlert version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>192.168.1.250</ipAddress><portNo>80</portNo><protocol>HTTP</protocol>
<macAddress>3c:1b:f8:38:ba:23</macAddress><channelID>0</channelID>
<dateTime>2026-09-09T17:02:40</dateTime><activePostCount>0</activePostCount>
<eventType>videoloss</eventType><eventState>inactive</eventState>
<eventDescription>videoloss alarm</eventDescription>
</EventNotificationAlert>`;

/** Same envelope, a motion pulse on channel 4. */
const MOTION_ALERT = `<EventNotificationAlert version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>192.168.1.250</ipAddress><portNo>80</portNo><protocol>HTTP</protocol>
<macAddress>3c:1b:f8:38:ba:23</macAddress><channelID>4</channelID>
<dateTime>2026-09-09T17:02:45</dateTime><activePostCount>1</activePostCount>
<eventType>VMD</eventType><eventState>active</eventState>
<eventDescription>Motion Alarm</eventDescription>
</EventNotificationAlert>`;

/** `Readable.from` defaults to object mode; `objectMode: false` is what makes `setEncoding` behave. */
function textStream(chunks: string[]): Readable {
  return Readable.from(chunks, { objectMode: false });
}

async function collect(events: AsyncIterable<DvrEvent>): Promise<DvrEvent[]> {
  const collected: DvrEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function axiosResponse<T>(
  data: T,
  headers: Record<string, string> = {},
  status = 200,
) {
  return of({ data, headers, status } as AxiosResponse<T>);
}

function digestChallenge(header: string = CHALLENGE) {
  return axiosResponse('', { 'www-authenticate': header }, 401);
}

function axiosFailure(status?: number, code?: string) {
  const error = new AxiosError('request failed', code);
  if (status) {
    error.response = { status } as AxiosResponse;
  }
  return throwError(() => error);
}

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

describe('HttpDvrClientService', () => {
  const maxBytes = 1000;

  let httpService: { request: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let envValues: Record<string, number | string>;
  let client: HttpDvrClientService;

  /** Answers the challenge on the first call and the payload on the retry. */
  function respondAfterChallenge<T>(
    data: T,
    headers: Record<string, string> = {},
  ) {
    httpService.request
      .mockReturnValueOnce(digestChallenge())
      .mockReturnValueOnce(axiosResponse(data, headers));
  }

  /** `mock.calls` is untyped; every read of a recorded request goes through here. */
  function calls(): AxiosRequestConfig[] {
    return (httpService.request.mock.calls as [AxiosRequestConfig][]).map(
      ([config]) => config,
    );
  }

  /** Pulls one field out of the Authorization header this client just built. */
  function authField(call: number, name: string): string | undefined {
    const header = calls()[call].headers?.Authorization as string;
    return new RegExp(`[ ,]${name}="?([^",]+)"?`).exec(header)?.[1];
  }

  let captureTotal: { inc: jest.Mock };
  let captureRetries: { inc: jest.Mock };

  beforeEach(() => {
    httpService = { request: jest.fn() };
    envValues = {
      [EnvNames.DVR_TIMEOUT_MS]: 5000,
      [EnvNames.SNAPSHOT_TIMEOUT_MS]: 5000,
      [EnvNames.SNAPSHOT_MAX_BYTES]: maxBytes,
      [EnvNames.DVR_RTSP_PORT]: 554,
      [EnvNames.DVR_RTSP_STREAM]: 'sub',
      [EnvNames.DVR_CAPTURE_RETRIES]: 1,
    };
    configService = {
      get: jest.fn((key: string) => envValues[key]),
      getOrThrow: jest.fn((key: string) => envValues[key]),
    };
    captureTotal = { inc: jest.fn() };
    captureRetries = { inc: jest.fn() };
    client = new HttpDvrClientService(
      httpService as never,
      configService as never,
      captureTotal as never,
      captureRetries as never,
    );
  });

  describe('digest authentication', () => {
    it('asks unauthenticated first, then signs the challenged nonce', async () => {
      respondAfterChallenge(CHANNELS_XML);

      await client.discoverChannels(connection);

      expect(httpService.request).toHaveBeenCalledTimes(2);
      // The first request has to survive its own 401 to read the challenge.
      const validateStatus = calls()[0].validateStatus as (
        status: number,
      ) => boolean;
      expect(validateStatus(401)).toBe(true);
      expect(validateStatus(500)).toBe(false);

      expect(authField(1, 'username')).toBe('admin');
      expect(authField(1, 'realm')).toBe('dvr-realm');
      expect(authField(1, 'nonce')).toBe('abc123');
      expect(authField(1, 'uri')).toBe('/ISAPI/System/Video/inputs/channels');
      expect(authField(1, 'opaque')).toBe('799d5');
      expect(authField(1, 'qop')).toBe('auth');
      expect(authField(1, 'nc')).toBe('00000001');

      const ha1 = md5('admin:dvr-realm:dvr-password');
      const ha2 = md5('GET:/ISAPI/System/Video/inputs/channels');
      const cnonce = authField(1, 'cnonce');
      expect(authField(1, 'response')).toBe(
        md5(`${ha1}:abc123:00000001:${cnonce}:auth:${ha2}`),
      );
    });

    /** The digest `uri` must be the path as sent, query string included. */
    it('signs the snapshot query string along with its path', async () => {
      respondAfterChallenge(Buffer.from('x'), { 'content-type': 'image/jpeg' });

      await client.captureSnapshot(connection, '4');

      expect(authField(1, 'uri')).toBe(
        '/ISAPI/Streaming/channels/401/picture?snapShotImageType=JPEG',
      );
    });

    /** A base URL with its own path prefix must be signed as the recorder sees it. */
    it('signs the path the base url prefix actually produces', async () => {
      respondAfterChallenge(CHANNELS_XML);

      await client.discoverChannels({ ...connection, url: 'http://host/dvr' });

      expect(authField(1, 'uri')).toBe(
        '/dvr/ISAPI/System/Video/inputs/channels',
      );
    });

    /** A second scheme reuses parameter names; the Digest ones have to survive. */
    it('keeps the digest parameters when another scheme follows them', async () => {
      httpService.request
        .mockReturnValueOnce(
          digestChallenge(
            'Digest realm="dvr-realm", qop="auth", nonce="abc123", ' +
              'Basic realm="somewhere-else"',
          ),
        )
        .mockReturnValueOnce(axiosResponse(CHANNELS_XML));

      await client.discoverChannels(connection);

      expect(authField(1, 'realm')).toBe('dvr-realm');
    });

    /** RFC 2069: no qop means no nonce count and no client nonce in the hash. */
    it('falls back to the unqualified response when the challenge omits qop', async () => {
      httpService.request
        .mockReturnValueOnce(
          digestChallenge('Digest realm="dvr-realm", nonce="abc123"'),
        )
        .mockReturnValueOnce(axiosResponse(CHANNELS_XML));

      await client.discoverChannels(connection);

      expect(authField(1, 'qop')).toBeUndefined();
      expect(authField(1, 'nc')).toBeUndefined();
      const ha1 = md5('admin:dvr-realm:dvr-password');
      const ha2 = md5('GET:/ISAPI/System/Video/inputs/channels');
      expect(authField(1, 'response')).toBe(md5(`${ha1}:abc123:${ha2}`));
    });

    it('hashes with SHA-256 when the recorder asks for it', async () => {
      httpService.request
        .mockReturnValueOnce(
          digestChallenge(
            'Digest realm="dvr-realm", qop="auth", nonce="abc123", ' +
              'algorithm="SHA-256"',
          ),
        )
        .mockReturnValueOnce(axiosResponse(CHANNELS_XML));

      await client.discoverChannels(connection);

      const sha256 = (value: string) =>
        createHash('sha256').update(value).digest('hex');
      const ha1 = sha256('admin:dvr-realm:dvr-password');
      const ha2 = sha256('GET:/ISAPI/System/Video/inputs/channels');
      const cnonce = authField(1, 'cnonce');
      expect(authField(1, 'response')).toBe(
        sha256(`${ha1}:abc123:00000001:${cnonce}:auth:${ha2}`),
      );
    });

    it('skips the retry when the recorder offers no digest challenge', async () => {
      httpService.request.mockReturnValueOnce(
        digestChallenge('Basic realm="dvr-realm"'),
      );

      const result = await client.discoverChannels(connection);

      expect(httpService.request).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    /** Only the signed attempt getting refused says the password is wrong. */
    it('maps a credential rejection on the signed retry to VALIDATION_ERROR', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosFailure(401));

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('discoverChannels', () => {
    it('asks the ISAPI listing endpoint without doubling the separator', async () => {
      respondAfterChallenge(CHANNELS_XML);

      await client.discoverChannels(connection);

      expect(calls()[0].url).toBe(CHANNELS_URL);
      expect(calls()[1].url).toBe(CHANNELS_URL);
    });

    /**
     * `videoInputEnabled` is true on every port, so a port is online only when
     * `resDesc` reports a resolution instead of the "NO VIDEO" placeholder.
     */
    it('reads the video input listing, keyed on the BNC port number', async () => {
      respondAfterChallenge(CHANNELS_XML);

      const result = await client.discoverChannels(connection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([
          {
            externalId: '1',
            name: 'Camera 01',
            location: null,
            status: 'offline',
          },
          {
            externalId: '3',
            name: 'Camera 03',
            location: null,
            status: 'online',
          },
          {
            externalId: '4',
            name: 'Patio & Garage',
            location: null,
            status: 'online',
          },
          {
            externalId: '8',
            name: 'Camera 8',
            location: null,
            status: 'online',
          },
        ]);
      }
    });

    /** Empty means unparsed, and unparsed must not unconfigure every camera. */
    it('reports an unreadable listing as an upstream error', async () => {
      respondAfterChallenge('<html>login</html>');

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    it('maps a timeout to UPSTREAM_TIMEOUT', async () => {
      httpService.request.mockReturnValueOnce(
        axiosFailure(undefined, 'ECONNABORTED'),
      );

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
      });
    });
  });

  describe('captureSnapshot', () => {
    it('pulls the main stream of the requested port', async () => {
      respondAfterChallenge(Buffer.from('x'), { 'content-type': 'image/jpeg' });

      await client.captureSnapshot(connection, '4');

      expect(calls()[1].url).toBe(
        'http://192.168.1.250/ISAPI/Streaming/channels/401/picture?snapShotImageType=JPEG',
      );
      expect(calls()[1]).toMatchObject({
        maxContentLength: maxBytes,
      });
    });

    it('describes the frame with its mime type, size and digest', async () => {
      const bytes = Buffer.from('image-bytes');
      respondAfterChallenge(bytes, {
        'content-type': 'image/jpeg; charset=binary',
      });

      const result = await client.captureSnapshot(connection, '4');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mimeType).toBe('image/jpeg');
        expect(result.data.byteSize).toBe(bytes.byteLength);
        expect(result.data.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('rejects an oversized frame that slipped past the transfer cap', async () => {
      respondAfterChallenge(Buffer.alloc(maxBytes + 1), {
        'content-type': 'image/jpeg',
      });

      const result = await client.captureSnapshot(connection, '4');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    it('rejects an answer that is not an image', async () => {
      respondAfterChallenge(Buffer.from('<html>'), {
        'content-type': 'text/html',
      });

      const result = await client.captureSnapshot(connection, '4');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    /** A stored identifier is still external input to the request path. */
    it('refuses a channel identifier that is not a video input number', async () => {
      const result = await client.captureSnapshot(
        connection,
        '4/../../System/deviceInfo',
      );

      expect(httpService.request).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('streamUrl', () => {
    it('builds the sub-stream channel on the RTSP port, not the ISAPI one', () => {
      const result = client.streamUrl(connection, '3');

      expect(result).toEqual({
        ok: true,
        data: 'rtsp://admin:dvr-password@192.168.1.250:554/Streaming/Channels/302',
      });
    });

    it('builds the main stream when configured to', () => {
      envValues[EnvNames.DVR_RTSP_STREAM] = 'main';

      const result = client.streamUrl(connection, '3');

      expect(result).toMatchObject({
        data: 'rtsp://admin:dvr-password@192.168.1.250:554/Streaming/Channels/301',
      });
    });

    it('honours a non-default RTSP port', () => {
      envValues[EnvNames.DVR_RTSP_PORT] = 10554;

      const result = client.streamUrl(connection, '3');

      expect(result).toMatchObject({
        data: 'rtsp://admin:dvr-password@192.168.1.250:10554/Streaming/Channels/302',
      });
    });

    // A raw `@` would move the host, a raw `/` the path.
    it('encodes credentials that would otherwise re-point the url', () => {
      const result = client.streamUrl(
        { url: 'http://dvr.local', username: 'ad min', password: 'p@ss/w:rd' },
        '4',
      );

      expect(result).toMatchObject({
        data: 'rtsp://ad%20min:p%40ss%2Fw%3Ard@dvr.local:554/Streaming/Channels/402',
      });
    });

    // `URL.hostname` keeps the brackets an IPv6 literal needs in front of the
    // port, so the host goes through untouched.
    it('keeps an IPv6 host bracketed', () => {
      const result = client.streamUrl(
        { ...connection, url: 'http://[fd00::1]/' },
        '1',
      );

      expect(result).toMatchObject({
        data: 'rtsp://admin:dvr-password@[fd00::1]:554/Streaming/Channels/102',
      });
    });

    /** Same rule as the snapshot path: a stored id is still external input. */
    it('refuses a channel identifier that is not a video input number', () => {
      const result = client.streamUrl(connection, '4/../../System/deviceInfo');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('refuses a stored base url that cannot be parsed', () => {
      const result = client.streamUrl({ ...connection, url: 'not a url' }, '3');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('linkMotionEvents', () => {
    /** Regression test: HA2 must sign the verb actually sent, not a hardcoded GET. */
    it('signs PUT: in HA2, not GET:', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML))
        .mockReturnValueOnce(axiosResponse(RESPONSE_STATUS_OK))
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML_WITH_CENTER));

      await client.linkMotionEvents(connection, '4');

      const putCall = 2;
      expect(calls()[putCall].method).toBe('put');
      const ha1 = md5('admin:dvr-realm:dvr-password');
      const ha2 = md5('PUT:/ISAPI/Event/triggers/VMD-4/notifications');
      const cnonce = authField(putCall, 'cnonce');
      expect(authField(putCall, 'nc')).toBe('00000002');
      expect(authField(putCall, 'response')).toBe(
        md5(`${ha1}:abc123:00000002:${cnonce}:auth:${ha2}`),
      );
    });

    it('keeps the notifications the operator already had', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML))
        .mockReturnValueOnce(axiosResponse(RESPONSE_STATUS_OK))
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML_WITH_CENTER));

      const result = await client.linkMotionEvents(connection, '4');

      expect(calls()[1].url).toBe(NOTIFICATIONS_URL);
      const putCall = calls()[2];
      expect(putCall.url).toBe(NOTIFICATIONS_URL);
      expect(putCall.headers?.['Content-Type']).toBe('application/xml');
      const body = putCall.data as string;
      expect(body).toContain('whiteLightOut-1');
      expect(body).toContain('record-1');
      expect(body).toContain('<id>center</id>');
      expect(result).toEqual({ ok: true, data: 'linked' });
    });

    it('writes nothing when the trigger already publishes', async () => {
      respondAfterChallenge(NOTIFICATIONS_XML_WITH_CENTER);

      const result = await client.linkMotionEvents(connection, '4');

      // Just the listing GET (challenge + signed retry) — no PUT, no re-GET.
      expect(httpService.request).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true, data: 'alreadyLinked' });
    });

    it('refuses a body that is not a notification list', async () => {
      respondAfterChallenge(
        '<ResponseStatus><statusCode>1</statusCode></ResponseStatus>',
      );

      const result = await client.linkMotionEvents(connection, '4');

      expect(httpService.request).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    it('reports a write the recorder accepted and silently dropped', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML))
        .mockReturnValueOnce(axiosResponse(RESPONSE_STATUS_OK))
        .mockReturnValueOnce(axiosResponse(NOTIFICATIONS_XML));

      const result = await client.linkMotionEvents(connection, '4');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
      if (!result.ok) {
        expect(result.message).toContain('OK');
      }
    });

    it('refuses an externalId that is not a video input number', async () => {
      const result = await client.linkMotionEvents(
        connection,
        '4/../../System/deviceInfo',
      );

      expect(httpService.request).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('challenge reuse', () => {
    const jpeg = () =>
      axiosResponse(new ArrayBuffer(4), { 'content-type': 'image/jpeg' });

    it('signs the second capture straight away, with no second challenge', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(jpeg())
        .mockReturnValueOnce(jpeg());

      await client.captureSnapshot(connection, '3');
      const afterFirst = httpService.request.mock.calls.length;
      const second = await client.captureSnapshot(connection, '3');

      expect(second.ok).toBe(true);
      // First capture: challenge plus signed retry. Second: signed only.
      expect(afterFirst).toBe(2);
      expect(httpService.request).toHaveBeenCalledTimes(3);
    });

    /** `nc` must move for as long as one nonce is reused, or the server refuses. */
    it('increments the nonce count on the reused challenge', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(jpeg())
        .mockReturnValueOnce(jpeg());

      await client.captureSnapshot(connection, '3');
      await client.captureSnapshot(connection, '3');

      expect(authField(1, 'nc')).toBe('00000001');
      expect(authField(2, 'nc')).toBe('00000002');
    });

    it('re-challenges when the recorder refuses the cached nonce', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(jpeg())
        // Second capture: the cached nonce is stale.
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(jpeg());

      await client.captureSnapshot(connection, '3');
      const second = await client.captureSnapshot(connection, '3');

      expect(second.ok).toBe(true);
      expect(httpService.request).toHaveBeenCalledTimes(5);
      expect(authField(4, 'nc')).toBe('00000001');
    });
  });

  describe('transient capture failures', () => {
    const jpeg = () =>
      axiosResponse(new ArrayBuffer(4), { 'content-type': 'image/jpeg' });

    it('retries a dropped connection and returns the second frame', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosFailure(undefined, 'ECONNRESET'))
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(jpeg());

      const result = await client.captureSnapshot(connection, '3');

      expect(result.ok).toBe(true);
      expect(captureRetries.inc).toHaveBeenCalledWith({ channel: '3' });
    });

    /** An answer is an answer. Asking again gets the same one. */
    it('does not retry a credential rejection', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosFailure(401));

      const result = await client.captureSnapshot(connection, '3');

      expect(result).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect(captureRetries.inc).not.toHaveBeenCalled();
    });

    it('does not retry an error the recorder answered with', async () => {
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(axiosFailure(500));

      await client.captureSnapshot(connection, '3');

      expect(captureRetries.inc).not.toHaveBeenCalled();
    });

    it('gives up at the configured cap and reports the last failure', async () => {
      envValues[EnvNames.DVR_CAPTURE_RETRIES] = 2;
      httpService.request.mockReturnValue(axiosFailure(undefined, 'ETIMEDOUT'));

      const result = await client.captureSnapshot(connection, '3');

      expect(result.ok).toBe(false);
      expect(captureRetries.inc).toHaveBeenCalledTimes(2);
      expect(captureTotal.inc).toHaveBeenCalledWith({
        channel: '3',
        outcome: 'error',
      });
    });

    it('counts a capture that worked', async () => {
      respondAfterChallenge(new ArrayBuffer(4), {
        'content-type': 'image/jpeg',
      });

      await client.captureSnapshot(connection, '3');

      expect(captureTotal.inc).toHaveBeenCalledWith({
        channel: '3',
        outcome: 'success',
      });
    });
  });

  describe('openEventStream', () => {
    it('releases the socket when the recorder answers an error', async () => {
      // A non-2xx answer still carries a body, and on this request the body is
      // an unread socket: without the discard a recorder answering 500 leaks
      // one connection per reconnect attempt.
      const body = Readable.from(['boom'], { objectMode: false });
      httpService.request
        .mockReturnValueOnce(digestChallenge())
        .mockReturnValueOnce(
          throwError(() =>
            Object.assign(new AxiosError('failed'), {
              response: { status: 500, headers: {}, data: body },
            }),
          ),
        );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(false);
      expect(body.destroyed).toBe(true);
    });

    it('yields one event for a document split across three chunks, including a split inside the closing tag', async () => {
      const closeTag = '</EventNotificationAlert>';
      // Both cuts land inside the last 25 characters of the document, i.e.
      // inside `closeTag` itself.
      const splitA = MOTION_ALERT.length - closeTag.length + 5;
      const splitB = MOTION_ALERT.length - 3;
      respondAfterChallenge(
        textStream([
          MOTION_ALERT.slice(0, splitA),
          MOTION_ALERT.slice(splitA, splitB),
          MOTION_ALERT.slice(splitB),
        ]),
        EVENT_STREAM_HEADERS,
      );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).resolves.toEqual([
          { kind: 'motion', externalId: '4' },
        ]);
      }
    });

    it('yields two events in order for two documents arriving in one chunk', async () => {
      respondAfterChallenge(
        textStream([HEARTBEAT_ALERT + MOTION_ALERT]),
        EVENT_STREAM_HEADERS,
      );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).resolves.toEqual([
          { kind: 'keepalive' },
          { kind: 'motion', externalId: '4' },
        ]);
      }
    });

    it('classifies the verbatim idle heartbeat as keepalive', async () => {
      respondAfterChallenge(
        textStream([HEARTBEAT_ALERT]),
        EVENT_STREAM_HEADERS,
      );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).resolves.toEqual([
          { kind: 'keepalive' },
        ]);
      }
    });

    it('classifies VMD + active + channelID 4 as motion on channel 4', async () => {
      respondAfterChallenge(textStream([MOTION_ALERT]), EVENT_STREAM_HEADERS);

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).resolves.toEqual([
          { kind: 'motion', externalId: '4' },
        ]);
      }
    });

    it('discards boundary lines and junk between parts and still parses the following document', async () => {
      const junk =
        '\r\n--boundary\r\nContent-Type: application/xml\r\n' +
        'Content-Length: 512\r\n\r\n';
      respondAfterChallenge(
        textStream([
          HEARTBEAT_ALERT + junk + MOTION_ALERT + '\r\n--boundary--\r\n',
        ]),
        EVENT_STREAM_HEADERS,
      );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).resolves.toEqual([
          { kind: 'keepalive' },
          { kind: 'motion', externalId: '4' },
        ]);
      }
    });

    it('throws when a document never closes past the cap', async () => {
      respondAfterChallenge(
        textStream(['<EventNotificationAlert' + 'x'.repeat(1_000_001)]),
        EVENT_STREAM_HEADERS,
      );

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        await expect(collect(result.data)).rejects.toThrow(
          'DVR event stream sent no complete notification',
        );
      }
    });

    it('destroys the stream when the consumer breaks out of the loop early', async () => {
      const body = textStream([HEARTBEAT_ALERT, MOTION_ALERT]);
      respondAfterChallenge(body, EVENT_STREAM_HEADERS);

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        for await (const event of result.data) {
          expect(event).toEqual({ kind: 'keepalive' });
          break;
        }
        expect(body.destroyed).toBe(true);
      }
    });

    it('returns UPSTREAM_ERROR and destroys the body for a non-multipart response', async () => {
      const body = textStream(['ignored']);
      respondAfterChallenge(body, { 'content-type': 'text/html' });

      const result = await client.openEventStream(
        connection,
        new AbortController().signal,
      );

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
      expect(body.destroyed).toBe(true);
    });

    it('requests the stream with no maxContentLength cap', async () => {
      respondAfterChallenge(
        textStream([HEARTBEAT_ALERT]),
        EVENT_STREAM_HEADERS,
      );

      await client.openEventStream(connection, new AbortController().signal);

      const signedCall = calls()[1];
      expect(signedCall.responseType).toBe('stream');
      expect(signedCall.timeout).toBe(0);
      expect(signedCall).not.toHaveProperty('maxContentLength');
    });

    /** The leak guard from d451562, exercised here for the first time on a stream body. */
    it('destroys a 401 challenge body that arrives as a stream before the signed retry', async () => {
      const challengeBody = textStream(['nope']);
      httpService.request
        .mockReturnValueOnce(
          axiosResponse(challengeBody, { 'www-authenticate': CHALLENGE }, 401),
        )
        .mockReturnValueOnce(
          axiosResponse(textStream([HEARTBEAT_ALERT]), EVENT_STREAM_HEADERS),
        );

      await client.openEventStream(connection, new AbortController().signal);

      expect(challengeBody.destroyed).toBe(true);
    });
  });
});
