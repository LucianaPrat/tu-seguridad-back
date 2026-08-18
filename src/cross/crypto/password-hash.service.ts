import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

/**
 * bcrypt stays the password hash for now: the setup-era admin row was written
 * with it and swapping to argon2id is a deliberate migration with a rehash path,
 * not a side effect of this plan. Every call site goes through this service so
 * that migration touches one file.
 */
const BCRYPT_COST = 10;

@Injectable()
export class PasswordHashService {
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, BCRYPT_COST);
  }

  verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
