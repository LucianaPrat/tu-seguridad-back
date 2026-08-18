import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
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
  @ApiProduces('image/jpeg')
  @ApiOkResponse({
    description: 'Snapshot bytes',
    schema: { type: 'string', format: 'binary' },
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
