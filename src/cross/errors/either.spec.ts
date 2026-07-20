import { ErrorCode } from '../common/constants';
import { buildData, buildError } from './either';

describe('Either builders', () => {
  it('buildData wraps a value as ok', () => {
    expect(buildData({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });

  it('buildError wraps a code and optional message as not-ok', () => {
    expect(buildError(ErrorCode.NOT_FOUND, 'missing')).toEqual({
      ok: false,
      code: ErrorCode.NOT_FOUND,
      message: 'missing',
    });
  });

  it('buildError allows an omitted message', () => {
    expect(buildError(ErrorCode.CONFLICT)).toEqual({
      ok: false,
      code: ErrorCode.CONFLICT,
      message: undefined,
    });
  });
});
