import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EnvNames } from '../../cross/common/constants';

/**
 * Domain separation. The same secret signs access tokens, so a value minted
 * here must not be usable anywhere else even if a future payload happens to
 * collide. Bump the version if the token layout ever changes — an old link then
 * stops verifying instead of being misread.
 */
const TOKEN_PURPOSE = 'event-ack:v1';

/**
 * 128 bits of tag. A MAC is not a secret to be guessed offline: the attacker
 * has no oracle, one delivery, and an operation that is idempotent once it has
 * run. Truncating keeps the emailed URL short enough to survive a mail client's
 * line wrapping.
 */
const MAC_BYTES = 16;

const TOKEN_SEPARATOR = '.';

/**
 * The credential an alert email carries so its recipient can acknowledge from
 * the message itself.
 *
 * It is deliberately *not* the delivery `correlationId`. That value is what the
 * provider webhook accepts and what `SENSITIVE_FIELD_NAMES` keeps out of every
 * log; mailing it would hand a working acknowledgement to whoever reads the
 * mailbox, forever. This token is derived instead: it authorizes exactly one
 * delivery, it is reproducible from the delivery id alone, and rotating
 * `JWT_SECRET` invalidates every link already in flight.
 *
 * Nothing is persisted. A stolen token is worth what a single acknowledgement
 * is worth, and `consumeInbound` is idempotent, so a replay after the first use
 * changes nothing.
 */
@Injectable()
export class EventAckTokenService {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>(EnvNames.JWT_SECRET)!;
  }

  issue(deliveryId: string): string {
    return `${deliveryId}${TOKEN_SEPARATOR}${this.sign(deliveryId)}`;
  }

  /** The delivery the token authorizes, or `null` for anything unverifiable. */
  resolve(token: string): string | null {
    const separator = token.lastIndexOf(TOKEN_SEPARATOR);
    if (separator <= 0) {
      return null;
    }

    const deliveryId = token.slice(0, separator);
    const presented = Buffer.from(token.slice(separator + 1), 'base64url');
    const expected = Buffer.from(this.sign(deliveryId), 'base64url');
    // Length is checked first because timingSafeEqual throws on a mismatch, and
    // a thrown error would answer faster than a wrong tag of the right length.
    if (presented.length !== expected.length) {
      return null;
    }
    return timingSafeEqual(presented, expected) ? deliveryId : null;
  }

  private sign(deliveryId: string): string {
    return createHmac('sha256', this.secret)
      .update(TOKEN_PURPOSE, 'utf8')
      .update('\0', 'utf8')
      .update(deliveryId, 'utf8')
      .digest()
      .subarray(0, MAC_BYTES)
      .toString('base64url');
  }
}
