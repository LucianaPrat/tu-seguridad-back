import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from './dto/access-token.dto';
import { FaceIdentityDto } from './dto/face-identity.dto';
import { FaceTokenDto } from './dto/face-token.dto';
import { FaceIdentityService } from './face-identity.service';
import { RefreshCookieService } from './refresh-cookie.service';

@ApiTags('auth')
@Controller('auth/face')
export class FaceIdentityController {
  constructor(
    private readonly faceIdentityService: FaceIdentityService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  /** Enrollment replaces the caller's previous active identity, keeping history. */
  @HttpCode(HttpStatus.CREATED)
  @Post('identities')
  @ApiOperation({
    summary: 'Enroll a face identity',
    description:
      'Registers a face token against the calling account so it can be used to log in ' +
      'later. Enrollment replaces the previous active identity rather than adding a ' +
      'second one; the replaced record is kept as history, so enrollments stay auditable.',
  })
  @ApiCreatedResponse({
    type: FaceIdentityDto,
    description: 'Identity enrolled and now the active one.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]:
      'Missing or invalid bearer token, or the account cannot be used for face login.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  register(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FaceTokenDto,
  ): Promise<Either<FaceIdentityDto>> {
    return this.faceIdentityService.register(user.sub, dto.faceToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({
    summary: 'Log in with a face identity',
    description:
      'Public — the face token is the credential, so no password is involved. Opens a ' +
      'session: the access token comes back in the body, the refresh token only as an ' +
      '`httpOnly` path-scoped cookie. An unrecognized face and a disabled account ' +
      'answer the same 401, on purpose.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description:
      'Session opened. Refresh token set as a cookie, never in the body.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]:
      'Face not recognized, or the account cannot be used.',
  })
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
