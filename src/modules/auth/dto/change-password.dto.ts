import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  currentPassword!: string;

  @ApiProperty({ minLength: AuthPolicy.MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(AuthPolicy.MIN_PASSWORD_LENGTH)
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  newPassword!: string;
}
