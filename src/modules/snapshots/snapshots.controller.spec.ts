import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { buildData, buildError } from '../../cross/errors/either';
import { SnapshotsController } from './snapshots.controller';

describe('SnapshotsController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'member@example.com',
    spaceId: 'space-uuid',
    role: 'member',
    profileCompleted: true,
  };

  let snapshotService: { read: jest.Mock };
  let response: { setHeader: jest.Mock; end: jest.Mock };
  let controller: SnapshotsController;

  beforeEach(() => {
    snapshotService = { read: jest.fn() };
    response = { setHeader: jest.fn(), end: jest.fn() };
    controller = new SnapshotsController(snapshotService as never);
  });

  it('writes the stored bytes with their own mime type', async () => {
    const data = Buffer.from('image-bytes');
    snapshotService.read.mockResolvedValue(
      buildData({ mimeType: 'image/png', byteSize: data.byteLength, data }),
    );

    await controller.read(
      user,
      'snapshot-uuid',
      response as unknown as Response,
    );

    expect(snapshotService.read).toHaveBeenCalledWith(
      'space-uuid',
      'snapshot-uuid',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/png',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, max-age=60',
    );
    expect(response.end).toHaveBeenCalledWith(data);
  });

  /**
   * The route bypasses the `EitherInterceptor` to write raw bytes, so it has to
   * throw the shared error body itself — a snapshot from another space must not
   * fall through as a 200 with an empty response.
   */
  it('throws the mapped error instead of writing a body', async () => {
    snapshotService.read.mockResolvedValue(
      buildError(ErrorCode.NOT_FOUND, 'Snapshot snapshot-uuid not found'),
    );

    await expect(
      controller.read(user, 'snapshot-uuid', response as unknown as Response),
    ).rejects.toBeInstanceOf(HttpException);
    expect(response.end).not.toHaveBeenCalled();
  });
});
