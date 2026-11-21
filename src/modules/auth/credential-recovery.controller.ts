import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: this appears in a decorated parameter position and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import type { SessionContext } from '../../cross/common/session-context.type';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { CredentialThrottle } from '../../cross/decorators/route-throttle.decorator';
import { CredentialRecoveryService } from './credential-recovery.service';
import { AccessTokenDto } from './dto/access-token.dto';
import { AcknowledgementDto } from './dto/acknowledgement.dto';
import { CredentialTokenDto } from './dto/credential-token.dto';
import { EmailRequestDto } from './dto/email-request.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshCookieService } from './refresh-cookie.service';

/**
 * Both request routes are public and answer identically whether or not the
 * address has an account.
 */
@ApiTags('auth')
@Controller('auth')
export class CredentialRecoveryController {
  constructor(
    private readonly recoveryService: CredentialRecoveryService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Public()
  @CredentialThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password-reset/request')
  @ApiOperation({
    summary: 'Request a password reset',
    description:
      'Public. Answers 202 with the same acknowledgement whether or not the address ' +
      'has an account — telling the two apart would turn this route into an ' +
      'account-existence oracle. Delivery happens out of band.',
  })
  @ApiAcceptedResponse({
    type: AcknowledgementDto,
    description: 'Request accepted. Same answer for an unknown address.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or an email that is not an address.',
  })
  requestPasswordReset(
    @Body() dto: EmailRequestDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.requestPasswordReset(dto.email);
  }

  @Public()
  @CredentialThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  @ApiOperation({
    summary: 'Confirm a password reset',
    description:
      'Public — the reset token is the credential. Sets the new password and revokes ' +
      'the token. Single-use: replaying it answers 401. Existing sessions are not ' +
      'silently kept alive, so the caller logs in again afterwards.',
  })
  @ApiOkResponse({
    type: AcknowledgementDto,
    description: 'Password changed.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or a password that fails the policy.',
    [ErrorCode.UNAUTHORIZED]: 'Unknown, expired or already-used reset token.',
  })
  confirmPasswordReset(
    @Body() dto: ResetPasswordDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.confirmPasswordReset(dto.token, dto.password);
  }

  @Public()
  @CredentialThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('magic-link/request')
  @ApiOperation({
    summary: 'Request a magic-link login',
    description:
      'Public. Answers 202 with the same acknowledgement whether or not the address ' +
      'has an account — telling the two apart would turn this route into an ' +
      'account-existence oracle. Delivery happens out of band.',
  })
  @ApiAcceptedResponse({
    type: AcknowledgementDto,
    description: 'Request accepted. Same answer for an unknown address.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or an email that is not an address.',
  })
  requestMagicLink(
    @Body() dto: EmailRequestDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.requestMagicLink(dto.email);
  }

  @Public()
  @CredentialThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('magic-link/consume')
  @ApiOperation({
    summary: 'Log in with a magic link',
    description:
      'Public — the magic-link token is the credential, so no password is involved. ' +
      'Opens a session: the access token comes back in the body, the refresh token ' +
      'only as an `httpOnly` path-scoped cookie. Single-use: replaying answers 401.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description:
      'Session opened. Refresh token set as a cookie, never in the body.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]:
      'Unknown, expired or already-used magic-link token.',
  })
  async consumeMagicLink(
    @Body() dto: CredentialTokenDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.recoveryService.consumeMagicLink(dto.token, context),
    );
  }
}
