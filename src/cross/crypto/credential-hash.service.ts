import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

type CredentialPurpose =
  | 'auth-token:refresh'
  | 'auth-token:magic-link'
  | 'auth-token:password-reset'
  | 'invitation'
  | 'face-identity';

@Injectable()
export class CredentialHashService {
  hashAuthToken(
    purpose: 'refresh' | 'magic_link' | 'password_reset',
    value: string,
  ): string {
    return this.hash(
      `auth-token:${purpose.replace('_', '-')}` as CredentialPurpose,
      value,
    );
  }

  hashInvitation(value: string): string {
    return this.hash('invitation', value);
  }

  hashFaceIdentity(value: string): string {
    return this.hash('face-identity', value);
  }

  private hash(purpose: CredentialPurpose, value: string): string {
    return createHash('sha256')
      .update(purpose, 'utf8')
      .update('\0', 'utf8')
      .update(value, 'utf8')
      .digest('hex');
  }
}
