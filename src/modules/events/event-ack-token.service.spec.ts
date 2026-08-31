import { EnvNames } from '../../cross/common/constants';
import { EventAckTokenService } from './event-ack-token.service';

const DELIVERY_ID = '6f1d2c48-0f0e-4a9b-9f2d-6f7c8b9a0d11';

function serviceWith(secret: string): EventAckTokenService {
  return new EventAckTokenService({
    get: (name: string) => (name === EnvNames.JWT_SECRET ? secret : undefined),
  } as never);
}

describe('EventAckTokenService', () => {
  let service: EventAckTokenService;

  beforeEach(() => {
    service = serviceWith('a-secret-that-signs-access-tokens-too');
  });

  it('round-trips the delivery it was issued for', () => {
    expect(service.resolve(service.issue(DELIVERY_ID))).toBe(DELIVERY_ID);
  });

  it('is deterministic, so the same link keeps working across restarts', () => {
    expect(service.issue(DELIVERY_ID)).toBe(service.issue(DELIVERY_ID));
  });

  it('refuses a token whose delivery id was swapped for another', () => {
    const token = service.issue(DELIVERY_ID);
    const forged = token.replace(
      DELIVERY_ID,
      '00000000-0000-4000-8000-000000000000',
    );

    expect(service.resolve(forged)).toBeNull();
  });

  it('refuses a tampered signature', () => {
    const token = service.issue(DELIVERY_ID);
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    expect(service.resolve(flipped)).toBeNull();
  });

  it('refuses a token signed with another secret', () => {
    const foreign = serviceWith('a different secret').issue(DELIVERY_ID);

    expect(service.resolve(foreign)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no separator', DELIVERY_ID],
    ['no delivery id', '.abcdef'],
    ['no signature', `${DELIVERY_ID}.`],
    ['not base64url', `${DELIVERY_ID}.****`],
  ])('resolves a %s token to nothing rather than throwing', (_case, token) => {
    expect(() => service.resolve(token)).not.toThrow();
    expect(service.resolve(token)).toBeNull();
  });

  it('never contains the raw delivery id alone as a credential', () => {
    // The id is public — it is in the token by design, so the lookup is a
    // primary-key read. What must not verify is the id without its signature.
    expect(service.resolve(DELIVERY_ID)).toBeNull();
  });

  it('stays short enough to survive a mail client wrapping the link', () => {
    expect(service.issue(DELIVERY_ID).length).toBeLessThan(72);
  });
});
