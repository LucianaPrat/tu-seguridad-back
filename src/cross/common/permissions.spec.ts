import {
  DEFAULT_MENU_ACCESS,
  MENU_KEYS,
  cameraScope,
  canSeeCamera,
  isMenuKey,
} from './permissions';

describe('permissions', () => {
  it('grants every section to admin, a subset to collaborator and guest', () => {
    expect(DEFAULT_MENU_ACCESS.admin).toEqual([...MENU_KEYS]);
    expect(DEFAULT_MENU_ACCESS.collaborator).toEqual([
      'home',
      'monitor',
      'events',
      'dvr',
      'channels',
    ]);
    expect(DEFAULT_MENU_ACCESS.guest).toEqual(['home', 'monitor']);
  });

  it('recognises only known menu keys', () => {
    expect(isMenuKey('dvr')).toBe(true);
    expect(isMenuKey('profile')).toBe(false);
    expect(isMenuKey(1)).toBe(false);
  });

  describe('camera scope', () => {
    const guest = { role: 'guest' as const, cameraIds: ['cam-1'] };
    const admin = { role: 'admin' as const, cameraIds: [] };
    const collaborator = { role: 'collaborator' as const, cameraIds: [] };

    it('limits only a guest', () => {
      expect(cameraScope(admin)).toBeUndefined();
      expect(cameraScope(collaborator)).toBeUndefined();
      expect(cameraScope(guest)).toEqual(['cam-1']);
    });

    it('lets a guest see only its cameras, and nobody-camera events not at all', () => {
      expect(canSeeCamera(guest, 'cam-1')).toBe(true);
      expect(canSeeCamera(guest, 'cam-2')).toBe(false);
      expect(canSeeCamera(guest, null)).toBe(false);
      expect(canSeeCamera(collaborator, null)).toBe(true);
    });
  });
});
