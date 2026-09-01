import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { createUploadOptions } from './cameras.module';

describe('createUploadOptions', () => {
  it('bounds the upload at SNAPSHOT_MAX_BYTES', () => {
    const getOrThrow = jest.fn().mockReturnValue(1234);
    const options = createUploadOptions({
      getOrThrow,
    } as unknown as ConfigService);

    expect(getOrThrow).toHaveBeenCalledWith(EnvNames.SNAPSHOT_MAX_BYTES);
    expect(options.limits?.fileSize).toBe(1234);
  });

  it('accepts one file per request', () => {
    const options = createUploadOptions({
      getOrThrow: () => 1234,
    } as unknown as ConfigService);

    expect(options.limits?.files).toBe(1);
  });
});
