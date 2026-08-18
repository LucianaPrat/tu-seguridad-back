import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

/** A raw one-time credential coming back from the link it was delivered in. */
export class CredentialTokenDto {
  @ApiProperty({ description: 'Opaque token from the delivered link' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_TOKEN_LENGTH)
  token!: string;
}
