import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EnvNames } from '../common/constants';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    this.key = Buffer.from(
      configService.getOrThrow<string>(EnvNames.DVR_PASSWORD_ENCRYPTION_KEY),
      'base64',
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext]
      .map((part) => part.toString('base64'))
      .join(':');
  }

  decrypt(serialized: string): string {
    const parts = serialized.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted field format');
    }
    const [ivText, authTagText, ciphertextText] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
