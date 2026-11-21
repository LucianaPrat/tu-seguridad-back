import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, seconds } from '@nestjs/throttler';
import { EnvNames } from '../common/constants';

/**
 * The limiter runs in every environment. It used to skip everything but
 * production, which meant staging — the environment that exists to rehearse
 * production — was the one place the limits were never exercised, and a
 * misconfigured limit would first be discovered by the traffic it was supposed
 * to refuse. A suite that needs the limiter out of the way turns it off at the
 * guard, where the intent is visible.
 */
export const createThrottlerOptions = (
  config: ConfigService,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      ttl: seconds(config.get<number>(EnvNames.THROTTLE_TTL_SECONDS, 1)),
      limit: config.get<number>(EnvNames.THROTTLE_LIMIT, 10),
    },
  ],
  getTracker: (req: Record<string, unknown>) => {
    const ips = req.ips as string[] | undefined;
    return (ips && ips.length > 0 ? ips[0] : (req.ip as string)) ?? 'unknown';
  },
});
