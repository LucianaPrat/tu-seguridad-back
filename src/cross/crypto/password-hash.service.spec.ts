import { PasswordHashService } from './password-hash.service';

describe('PasswordHashService', () => {
  const service = new PasswordHashService();
  const password = 'correct horse battery staple';
  let hash: string;

  beforeAll(async () => {
    hash = await service.hash(password);
  });

  it('verifies a password against its own hash', async () => {
    await expect(service.verify(password, hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    await expect(service.verify('wrong password', hash)).resolves.toBe(false);
  });

  it('does not store the password as plaintext', () => {
    expect(hash).not.toBe(password);
  });

  it('salts each hash differently', async () => {
    const other = await service.hash(password);

    expect(other).not.toBe(hash);
  });
});
