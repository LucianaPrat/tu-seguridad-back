import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

const DVR_URL_PATTERN = /^https?:\/\/\S+$/;

export class ConfigureDvrDto {
  /**
   * Deliberately not `@IsUrl`: recorders live on the LAN behind names like
   * `http://dvr.local:8000` or a bare IP, and the internet-only validator
   * rejects exactly those.
   */
  @ApiProperty({ example: 'http://192.168.1.10:8000' })
  @Matches(DVR_URL_PATTERN, {
    message: 'url must start with http:// or https:// and carry a host',
  })
  @Length(1, 255)
  url!: string;

  /**
   * A digest header cannot carry a control character, so a username holding one
   * could never be presented to the recorder at all. Refusing it here is the
   * operator's 400 instead of an opaque upstream failure at discovery time.
   */
  @ApiProperty({ example: 'admin' })
  @Matches(/^[^\p{Cc}]+$/u, {
    message: 'username must not contain control characters',
  })
  @IsString()
  @Length(1, 100)
  username!: string;

  @ApiProperty({ example: 'dvr-password' })
  @IsString()
  @Length(1, 200)
  password!: string;

  @ApiProperty({ example: 'America/Argentina/Buenos_Aires' })
  @IsString()
  @Length(1, 100)
  timezone!: string;
}
