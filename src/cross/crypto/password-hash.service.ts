import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

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

  /**
   * A comparison that cannot succeed, for the branch where there was nothing to
   * compare against. Without it, a login for an address that exists waits out a
   * bcrypt compare and one for an address that does not returns immediately —
   * the bodies are identical, the clock is not, and the difference is the whole
   * account-enumeration oracle.
   *
   * This removes the large signal, not every signal: a lab-grade measurement
   * can still see the database lookup. The rate limits on the credential routes
   * are the other half of the answer.
   *
   * The hash is random and computed once, on first use. A constant in the source
   * would work equally well and would be one more bcrypt string in the tree for
   * a reader to wonder about.
   */
  async verifyAgainstDummy(plaintext: string): Promise<void> {
    this.dummyHash ??= await bcrypt.hash(randomUUID(), BCRYPT_COST);
    await bcrypt.compare(plaintext, this.dummyHash);
  }

  private dummyHash?: string;
}
