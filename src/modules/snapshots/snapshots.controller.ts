import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { ErrorCode } from '../../cross/common/constants';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { buildGuardException } from '../../cross/errors/guard-exception';
import { SnapshotService } from './snapshot.service';

// Bytes that belong to one space and change every capture: private, briefly
// cacheable so a re-rendered grid does not re-read the BLOB, never shared.
const CACHE_CONTROL = 'private, max-age=60';

@ApiTags('snapshots')
@ApiBearerAuth()
@Controller('snapshots')
export class SnapshotsController {
  constructor(private readonly snapshotService: SnapshotService) {}

  /**
   * The only way stored image bytes leave the process. Uses `@Res` because the
   * body is an image, not an `Either` for the interceptor to unwrap; failures
   * still throw the shared `{ statusCode, code, message }` body.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Read a stored snapshot',
    description:
      'Answers the raw image bytes of one stored frame. This is the only route that ' +
      'serves them: snapshots live in the database and are resolved inside the caller ' +
      "space, so another space's id answers 404 rather than the image. Cached " +
      '`private, max-age=60` — the bytes are per-space and must not be shared.',
  })
  @ApiParam({
    name: 'id',
    description: 'Snapshot id, taken from a camera read or a capture answer.',
  })
  // Content type is declared on the 200 only, not with an operation-level
  // `@ApiProduces`: that one applies to every response, and it would tell a
  // client the JSON error bodies below are `image/jpeg` too.
  @ApiOkResponse({
    description: 'Snapshot bytes. `Content-Type` follows the stored image.',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No snapshot with that id in the caller space.',
  })
  async read(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.snapshotService.read(user.spaceId, id);
    if (!result.ok) {
      throw buildGuardException(
        result.code,
        result.message ?? 'Snapshot not found',
      );
    }

    res.setHeader('Content-Type', result.data.mimeType);
    res.setHeader('Content-Length', result.data.byteSize);
    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.end(result.data.data);
  }
}
