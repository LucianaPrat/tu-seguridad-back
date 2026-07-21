import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM field encryption for sensitive columns at rest.
// Stored format: "<ivHex>:<authTagHex>:<ciphertextHex>".
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM recommendation
const KEY_LENGTH = 32; // 256-bit key
const ENCRYPTED_SHAPE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

/**
 * Decode a key from base64 or hex into exactly 32 bytes.
 * Throws if it does not decode to a 256-bit key — used both at boot
 * (env validation) and by the accessor, so misconfig fails fast.
 */
export function normalizeEncryptionKey(raw: string): Buffer {
  const isHex = /^[0-9a-fA-F]{64}$/.test(raw);
  const key = isHex ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      'encryption key must decode (hex or base64) to exactly 32 bytes',
    );
  }
  return key;
}

/** True if the value has the stored "iv:tag:ciphertext" hex shape. */
export function looksEncrypted(value: string): boolean {
  return ENCRYPTED_SHAPE.test(value);
}

export function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptField(stored: string, key: Buffer): string {
  const [ivHex, tagHex, dataHex] = stored.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('malformed encrypted field');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
