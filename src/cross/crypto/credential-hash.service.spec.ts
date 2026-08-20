import { CredentialHashService } from './credential-hash.service';

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

  it('keeps the auth-token purposes apart from each other', () => {
    const refresh = service.hashAuthToken('refresh', 'same-value');
    const magicLink = service.hashAuthToken('magic_link', 'same-value');
    const passwordReset = service.hashAuthToken('password_reset', 'same-value');

    expect(refresh).not.toBe(magicLink);
    expect(refresh).not.toBe(passwordReset);
    expect(magicLink).not.toBe(passwordReset);
  });
});
