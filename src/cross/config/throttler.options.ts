import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, seconds } from '@nestjs/throttler';
import { EnvNames } from '../common/constants';

export const createThrottlerOptions = (
  config: ConfigService,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      ttl: seconds(config.get<number>(EnvNames.THROTTLE_TTL_SECONDS, 1)),
      limit: config.get<number>(EnvNames.THROTTLE_LIMIT, 10),
    },
  ],
  skipIf: () => config.get<string>(EnvNames.NODE_ENV) !== 'production',
  getTracker: (req: Record<string, unknown>) => {
    const ips = req.ips as string[] | undefined;
    return (ips && ips.length > 0 ? ips[0] : (req.ip as string)) ?? 'unknown';
  },
});
