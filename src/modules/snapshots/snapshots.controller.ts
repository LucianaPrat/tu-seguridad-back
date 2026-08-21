import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Request, Response } from 'express';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { ErrorCode } from '../../cross/common/constants';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { buildGuardException } from '../../cross/errors/guard-exception';
import { SnapshotService } from './snapshot.service';

// A camera's live row is rewritten in place, so these bytes change while the
// id in the URL stays the same: any positive `max-age` makes the browser answer
// a refresh from its own disk cache with the previous frame. `no-cache` keeps
// the copy but revalidates every read, and the stored sha256 is the validator,
// so an unchanged frame still costs a 304 instead of the BLOB.
const CACHE_CONTROL = 'private, no-cache';

@ApiTags('snapshots')
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
      '`private, no-cache` with the frame sha256 as `ETag`: the live row is rewritten ' +
      'in place, so the same id answers different bytes and the browser has to ' +
      'revalidate. An unchanged frame answers 304.',
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
  @ApiResponse({
    status: 304,
    description:
      'The caller already holds this frame (`If-None-Match` matched).',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No snapshot with that id in the caller space.',
  })
  async read(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.snapshotService.read(user.spaceId, id);
    if (!result.ok) {
      throw buildGuardException(
        result.code,
        result.message ?? 'Snapshot not found',
      );
    }

    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.setHeader('ETag', `"${result.data.sha256}"`);
    // `req.fresh` is Express' own `If-None-Match` comparison against the ETag
    // just written, so the 304 path needs no hand-rolled header parsing.
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', result.data.mimeType);
    res.setHeader('Content-Length', result.data.byteSize);
    res.end(result.data.data);
  }
}
