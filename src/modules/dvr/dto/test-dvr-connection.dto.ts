import { PickType } from '@nestjs/swagger';
import { ConfigureDvrDto } from './configure-dvr.dto';

/**
 * The credentials half of `ConfigureDvrDto`. A probe stores nothing, so the
 * time zone — which only matters once stored timestamps get rendered — is not
 * part of it, and the global whitelist rejects it if sent anyway.
 */
export class TestDvrConnectionDto extends PickType(ConfigureDvrDto, [
  'url',
  'username',
  'password',
] as const) {}
