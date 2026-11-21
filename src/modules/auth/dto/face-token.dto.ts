import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

/**
 * The opaque identifier Face Auth hands back for a recognized person. Only its
 * hash is persisted, so the same value is presented on every login.
 */
export class FaceTokenDto {
  @ApiProperty({ description: 'Opaque Face Auth identifier' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_TOKEN_LENGTH)
  faceToken!: string;
}
