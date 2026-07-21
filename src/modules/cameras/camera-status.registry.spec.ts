import { CameraStatusRegistry } from './camera-status.registry';

describe('CameraStatusRegistry', () => {
  let registry: CameraStatusRegistry;

  beforeEach(() => {
    registry = new CameraStatusRegistry();
  });

  it('returns an all-null empty status for an unknown camera', () => {
    expect(registry.get('camera_01')).toEqual({
      cameraId: 'camera_01',
      lastPolledAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastLatencyMs: null,
      lastPersonsDetected: null,
      skippedPolls: 0,
      zones: [],
    });
  });

  it('record() merges a patch into the existing status', () => {
    registry.record('camera_01', { lastPersonsDetected: true });
    registry.record('camera_01', { lastLatencyMs: 42 });

    const status = registry.get('camera_01');
    expect(status.lastPersonsDetected).toBe(true);
    expect(status.lastLatencyMs).toBe(42);
  });

  it('incrementSkipped() bumps the counter without touching other fields', () => {
    registry.record('camera_01', { lastPersonsDetected: true });

    registry.incrementSkipped('camera_01');
    registry.incrementSkipped('camera_01');

    const status = registry.get('camera_01');
    expect(status.skippedPolls).toBe(2);
    expect(status.lastPersonsDetected).toBe(true);
  });

  it('tracks state independently per camera', () => {
    registry.record('camera_01', { lastPersonsDetected: true });
    registry.record('camera_02', { lastPersonsDetected: false });

    expect(registry.get('camera_01').lastPersonsDetected).toBe(true);
    expect(registry.get('camera_02').lastPersonsDetected).toBe(false);
  });
});
