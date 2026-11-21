import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';
import { CredentialTokenDto } from './credential-token.dto';

export class ResetPasswordDto extends CredentialTokenDto {
  @ApiProperty({ minLength: AuthPolicy.MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(AuthPolicy.MIN_PASSWORD_LENGTH)
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  password!: string;
}
