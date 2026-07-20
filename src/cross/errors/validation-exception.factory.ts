import { BadRequestException, ValidationError } from '@nestjs/common';
import { ErrorCode } from '../common/constants';

function flattenMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenMessages(error.children ?? []),
  ]);
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: ErrorCode.VALIDATION_ERROR,
    message: flattenMessages(errors).join('; '),
  });
}
