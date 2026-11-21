import { createHash } from 'node:crypto';
import { CredentialHashService } from './credential-hash.service';

// The digest the service must produce for a given purpose label. Recomputed here
// rather than snapshotted, so the assertion names the label under test.
const digestFor = (purpose: string, value: string) =>
  createHash('sha256')
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');

describe('CredentialHashService', () => {
  let service: CredentialHashService;

  beforeEach(() => {
    service = new CredentialHashService();
  });

  it('hashes the same value the same way every time', () => {
    expect(service.hashInvitation('token-123')).toBe(
      service.hashInvitation('token-123'),
    );
  });

  it('hashes a different value differently', () => {
    expect(service.hashInvitation('token-123')).not.toBe(
      service.hashInvitation('token-456'),
    );
  });

  it('returns a hex sha256 digest', () => {
    expect(service.hashInvitation('token-123')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps invitation and auth-token hashes of the same value apart', () => {
    expect(service.hashInvitation('same-value')).not.toBe(
      service.hashAuthToken('refresh', 'same-value'),
    );
  });

  it('keeps face-identity hashes apart from other purposes', () => {
    expect(service.hashFaceIdentity('same-value')).not.toBe(
      service.hashInvitation('same-value'),
    );
  });

  // Pairwise inequality alone would pass on a label the service never meant to
  // derive: an underscore left in place still hashes to something unique. Every
  // underscore has to become a dash, or a persisted hash stops verifying with no
  // error anywhere.
  it.each([
    ['refresh', 'auth-token:refresh'],
    ['magic_link', 'auth-token:magic-link'],
    ['password_reset', 'auth-token:password-reset'],
  ] as const)('derives the %s purpose label as %s', (purpose, label) => {
    expect(service.hashAuthToken(purpose, 'same-value')).toBe(
      digestFor(label, 'same-value'),
    );
  });

  it('keeps the auth-token purposes apart from each other', () => {
    const refresh = service.hashAuthToken('refresh', 'same-value');
    const magicLink = service.hashAuthToken('magic_link', 'same-value');
    const passwordReset = service.hashAuthToken('password_reset', 'same-value');

    expect(refresh).not.toBe(magicLink);
    expect(refresh).not.toBe(passwordReset);
    expect(magicLink).not.toBe(passwordReset);
  });
});
