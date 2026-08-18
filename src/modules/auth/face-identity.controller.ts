import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from './dto/access-token.dto';
import { FaceIdentityDto } from './dto/face-identity.dto';
import { FaceTokenDto } from './dto/face-token.dto';
import { FaceIdentityService } from './face-identity.service';
import { RefreshCookieService } from './refresh-cookie.service';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/face')
export class FaceIdentityController {
  constructor(
    private readonly faceIdentityService: FaceIdentityService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  /** Enrollment replaces the caller's previous active identity, keeping history. */
  @HttpCode(HttpStatus.CREATED)
  @Post('identities')
  @ApiOkResponse({ type: FaceIdentityDto })
  register(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FaceTokenDto,
  ): Promise<Either<FaceIdentityDto>> {
    return this.faceIdentityService.register(user.sub, dto.faceToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOkResponse({ type: AccessTokenDto })
  async login(
    @Body() dto: FaceTokenDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.faceIdentityService.login(dto.faceToken, context),
    );
  }
}
