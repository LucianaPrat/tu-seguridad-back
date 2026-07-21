import * as Sentry from '@sentry/node';
import { initSentry, scrubSensitive } from './sentry';

jest.mock('@sentry/node');
const init = Sentry.init as jest.Mock;

describe('sentry', () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    init.mockClear();
  });

  describe('scrubSensitive', () => {
    it('redacts snapshotUrl and auth/upstream headers at any depth', () => {
      const event = {
        request: {
          headers: {
            Authorization: 'Bearer leak-me',
            'Fa-Token': 'secret-token',
            accept: 'application/json',
          },
        },
        extra: {
          camera: {
            snapshotUrl: 'http://user:pass@dvr.local/snap.jpg',
            name: 'front-door',
          },
        },
      };

      const scrubbed = scrubSensitive(event);

      expect(scrubbed.request.headers.Authorization).toBe('[redacted]');
      expect(scrubbed.request.headers['Fa-Token']).toBe('[redacted]');
      expect(scrubbed.request.headers.accept).toBe('application/json');
      expect(scrubbed.extra.camera.snapshotUrl).toBe('[redacted]');
      expect(scrubbed.extra.camera.name).toBe('front-door');
    });

    it('handles circular references without looping', () => {
      const obj: Record<string, unknown> = { snapshotUrl: 'x' };
      obj.self = obj;

      const scrubbed = scrubSensitive(obj);

      expect(scrubbed.snapshotUrl).toBe('[redacted]');
      expect(scrubbed.self).toBe(scrubbed);
    });
  });

  describe('initSentry', () => {
    it('does nothing when SENTRY_DSN is unset', () => {
      delete process.env.SENTRY_DSN;

      initSentry();

      expect(init).not.toHaveBeenCalled();
    });

    it('initializes with a scrubbing beforeSend when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';

      initSentry();

      expect(init).toHaveBeenCalledTimes(1);
      const [options] = init.mock.calls[0] as [
        {
          dsn: string;
          beforeSend: (event: unknown) => { extra: { snapshotUrl: string } };
        },
      ];
      expect(options.dsn).toBe(process.env.SENTRY_DSN);
      const scrubbed = options.beforeSend({ extra: { snapshotUrl: 'x' } });
      expect(scrubbed.extra.snapshotUrl).toBe('[redacted]');
    });
  });
});
