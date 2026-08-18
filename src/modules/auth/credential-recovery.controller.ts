import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
// `import type` is required: this appears in a decorated parameter position and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import type { SessionContext } from '../../cross/common/session-context.type';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { Either } from '../../cross/errors/either';
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
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password-reset/request')
  @ApiOkResponse({ type: AcknowledgementDto })
  requestPasswordReset(
    @Body() dto: EmailRequestDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.requestPasswordReset(dto.email);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  @ApiOkResponse({ type: AcknowledgementDto })
  confirmPasswordReset(
    @Body() dto: ResetPasswordDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.confirmPasswordReset(dto.token, dto.password);
  }

  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('magic-link/request')
  @ApiOkResponse({ type: AcknowledgementDto })
  requestMagicLink(
    @Body() dto: EmailRequestDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.recoveryService.requestMagicLink(dto.email);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('magic-link/consume')
  @ApiOkResponse({ type: AccessTokenDto })
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
