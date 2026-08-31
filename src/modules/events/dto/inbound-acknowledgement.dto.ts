import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

/**
 * How an alert gets acknowledged from outside a session. Exactly one credential,
 * and which one says who is calling:
 *
 * - `correlationId` — the value issued with a delivery and handed to a
 *   notification provider. It is never returned by any other route and never
 *   put in a message, so holding it means being that provider.
 * - `token` — the value in the acknowledge link of an alert email, derived per
 *   delivery. Holding it means having received that email.
 *
 * Both are credentials, so both are on `SENSITIVE_FIELD_NAMES` and neither is
 * ever logged. Both optional here and exactly-one enforced by the service: the
 * rule is a relationship between two fields, which is a service decision, and
 * putting it in a custom validator would split it from the branch that acts on
 * it.
 */
export class InboundAcknowledgementDto {
  @ApiPropertyOptional({
    description:
      'The correlation id sent with the delivery. Provider callbacks only.',
  })
  @IsOptional()
  @IsString()
  @Length(1, AuthPolicy.MAX_TOKEN_LENGTH)
  correlationId?: string;

  @ApiPropertyOptional({
    description: 'The token from the acknowledge link of an alert email.',
  })
  @IsOptional()
  @IsString()
  @Length(1, AuthPolicy.MAX_TOKEN_LENGTH)
  token?: string;
}
