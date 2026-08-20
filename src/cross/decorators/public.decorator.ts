import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the global auth guard — and says so in the published
 * contract. The `ApiSecurity({})` half is not decoration: the controllers that
 * carry a class-level `@ApiBearerAuth()` would otherwise advertise bearer auth
 * on their public routes, so an integrator reading `openapi.json` would send a
 * token no route accepts, or assume a webhook is authenticated when it is not.
 * Composing it here means the contract cannot drift from the guard.
 */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiSecurity({}));
