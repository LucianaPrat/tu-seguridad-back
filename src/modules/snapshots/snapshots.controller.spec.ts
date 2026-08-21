import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
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
  let request: { fresh: boolean };
  let response: { setHeader: jest.Mock; end: jest.Mock; status: jest.Mock };
  let controller: SnapshotsController;

  beforeEach(() => {
    snapshotService = { read: jest.fn() };
    request = { fresh: false };
    response = {
      setHeader: jest.fn(),
      end: jest.fn(),
      status: jest.fn(),
    };
    response.status.mockReturnValue(response);
    controller = new SnapshotsController(snapshotService as never);
  });

  const read = () =>
    controller.read(
      user,
      'snapshot-uuid',
      request as unknown as Request,
      response as unknown as Response,
    );

  it('writes the stored bytes with their own mime type', async () => {
    const data = Buffer.from('image-bytes');
    snapshotService.read.mockResolvedValue(
      buildData({
        mimeType: 'image/png',
        byteSize: data.byteLength,
        sha256: 'abc123',
        data,
      }),
    );

    await read();

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
      'private, no-cache',
    );
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"abc123"');
    expect(response.end).toHaveBeenCalledWith(data);
  });

  /**
   * The live row keeps its id when a new capture overwrites it, so a positive
   * `max-age` would let the browser answer a refresh with the previous frame.
   * The bytes are only skipped when the caller's `If-None-Match` still matches.
   */
  it('answers 304 without bytes when the caller already holds the frame', async () => {
    request.fresh = true;
    snapshotService.read.mockResolvedValue(
      buildData({
        mimeType: 'image/png',
        byteSize: 11,
        sha256: 'abc123',
        data: Buffer.from('image-bytes'),
      }),
    );

    await read();

    expect(response.status).toHaveBeenCalledWith(304);
    expect(response.end).toHaveBeenCalledWith();
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Content-Length',
      expect.anything(),
    );
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

    await expect(read()).rejects.toBeInstanceOf(HttpException);
    expect(response.end).not.toHaveBeenCalled();
  });
});
