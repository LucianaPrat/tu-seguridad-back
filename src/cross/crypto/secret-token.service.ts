import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/**
 * Raw one-time credentials: invitation links, magic links, password resets, and
 * the placeholder password an invited account carries until it completes its
 * profile. 256 bits from the CSPRNG, base64url so the value survives a URL
 * without escaping. Only its hash is ever persisted.
 */
@Injectable()
export class SecretTokenService {
  generate(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }
}
