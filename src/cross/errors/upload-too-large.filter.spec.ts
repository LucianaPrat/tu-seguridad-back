import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import { UploadTooLargeFilter } from './upload-too-large.filter';

describe('UploadTooLargeFilter', () => {
  const buildHost = (): {
    host: ArgumentsHost;
    status: jest.Mock;
    json: jest.Mock;
  } => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('answers the same envelope as the in-service size check', () => {
    const { host, status, json } = buildHost();

    new UploadTooLargeFilter().catch(new PayloadTooLargeException(), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: expect.stringContaining('larger than') as unknown,
    });
  });
});
