import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EnvNames } from '../common/constants';
import { FieldEncryptionService } from './field-encryption.service';

/** The service reads one key and nothing else, so the fake carries one method. */
type ConfigStub = Pick<ConfigService, 'getOrThrow'>;

function stubConfig(key: Buffer): ConfigStub {
  return { getOrThrow: jest.fn().mockReturnValue(key.toString('base64')) };
}

describe('FieldEncryptionService', () => {
  function serviceWithKey(key: Buffer): FieldEncryptionService {
    return new FieldEncryptionService(stubConfig(key) as ConfigService);
  }

  const plaintext = 'super secret dvr password';
  let service: FieldEncryptionService;

  beforeEach(() => {
    service = serviceWithKey(randomBytes(32));
  });

  it('reads the encryption key from DVR_PASSWORD_ENCRYPTION_KEY', () => {
    const configService = stubConfig(randomBytes(32));

    new FieldEncryptionService(configService as ConfigService);

    expect(configService.getOrThrow).toHaveBeenCalledWith(
      EnvNames.DVR_PASSWORD_ENCRYPTION_KEY,
    );
  });

  it('decrypts back to the original plaintext', () => {
    const encrypted = service.encrypt(plaintext);

    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('encrypts the same plaintext to different ciphertext each time', () => {
    const first = service.encrypt(plaintext);
    const second = service.encrypt(plaintext);

    expect(first).not.toBe(second);
  });

  it('never leaks the plaintext inside the ciphertext', () => {
    const encrypted = service.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const encrypted = service.encrypt(plaintext);
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tampered = Buffer.from(ciphertext, 'base64');
    tampered[0] ^= 0xff;
    const serialized = [iv, authTag, tampered.toString('base64')].join(':');

    expect(() => service.decrypt(serialized)).toThrow();
  });

  it('rejects decryption with a different key', () => {
    const encrypted = service.encrypt(plaintext);
    const otherService = serviceWithKey(randomBytes(32));

    expect(() => otherService.decrypt(encrypted)).toThrow();
  });

  it('rejects a malformed serialized value', () => {
    expect(() => service.decrypt('not-a-valid-format')).toThrow(
      'Invalid encrypted field format',
    );
  });
});
