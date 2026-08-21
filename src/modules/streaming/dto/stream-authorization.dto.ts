import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * The payload MediaMTX POSTs for every request it is asked to authorize — the
 * playlist and each segment alike.
 *
 * **Every field the media server sends is declared here on purpose.** The
 * global pipe runs with `forbidNonWhitelisted`, so one undeclared field turns
 * the whole hook into a 400 and MediaMTX, seeing anything but 200, denies every
 * viewer. A field added by a future MediaMTX release has to land here in the
 * same change that upgrades it.
 */
export class StreamAuthorizationDto {
  @ApiProperty({
    description:
      'What the caller is trying to do. Only `read` is ever authorized: a ' +
      'granted `publish` would let someone push their own video into a camera ' +
      "path and the dashboard would render it as that camera's feed.",
  })
  @IsString()
  action!: string;

  @ApiProperty({
    description: 'The media-server path being requested. This is a camera id.',
  })
  @IsString()
  path!: string;

  @ApiPropertyOptional({
    description:
      'The bearer token hls.js attached to the request. Validated as a normal ' +
      'access token — the same secret, the same claims, the same refusal of a ' +
      'refresh token.',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Transport the reader used. Only `hls` is handed out.',
  })
  @IsOptional()
  @IsString()
  protocol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class StreamAuthorizationResultDto {
  @ApiProperty({
    description:
      'Always `true` when the call succeeds. MediaMTX reads the status code, ' +
      'not the body; the body exists so a human debugging the hook sees an answer.',
  })
  authorized!: boolean;
}
