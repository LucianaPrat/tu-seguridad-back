import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * The part of the payload MediaMTX POSTs that this API reads — for the playlist
 * and for each segment alike.
 *
 * MediaMTX sends more than this (`user`, `password`, `ip`, `id`, `query`,
 * `user_agent`), and a future release will send more still. Everything not
 * declared here is **stripped**, not refused: the route validates the body with
 * `whitelist` and without `forbidNonWhitelisted`, because a 400 on an unknown
 * field would make the media server deny every viewer at once. See the pipe on
 * `StreamingController.authorize`.
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
}

export class StreamAuthorizationResultDto {
  @ApiProperty({
    description:
      'Always `true` when the call succeeds. MediaMTX reads the status code, ' +
      'not the body; the body exists so a human debugging the hook sees an answer.',
  })
  authorized!: boolean;
}
