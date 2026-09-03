import { Throttle, seconds } from '@nestjs/throttler';
import { RouteThrottle } from '../common/constants';

/**
 * Named limits for the two route classes the global allowance does not fit.
 * Named, rather than a `@Throttle({ default: { ... } })` literal on each of the
 * eight routes, because the point is that they agree: a credential route that
 * quietly got its own number would be the one an attacker finds.
 */
export const CredentialThrottle = () =>
  Throttle({
    default: {
      limit: RouteThrottle.CREDENTIAL.limit,
      ttl: seconds(RouteThrottle.CREDENTIAL.ttlSeconds),
    },
  });

export const InboundThrottle = () =>
  Throttle({
    default: {
      limit: RouteThrottle.INBOUND.limit,
      ttl: seconds(RouteThrottle.INBOUND.ttlSeconds),
    },
  });

export const AssistantThrottle = () =>
  Throttle({
    default: {
      limit: RouteThrottle.ASSISTANT.limit,
      ttl: seconds(RouteThrottle.ASSISTANT.ttlSeconds),
    },
  });
