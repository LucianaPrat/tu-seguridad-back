import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

/**
 * What a provider webhook sends back. The correlation id is the only credential
 * the route has, which is why it is generated from the CSPRNG per delivery and
 * never leaves the process through any other response.
 */
export class InboundAcknowledgementDto {
  @ApiProperty({ description: 'The correlation id sent with the delivery' })
  @IsString()
  @Length(1, AuthPolicy.MAX_TOKEN_LENGTH)
  correlationId!: string;
}
