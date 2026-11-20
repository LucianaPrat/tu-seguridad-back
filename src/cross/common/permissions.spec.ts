import { DEFAULT_MENU_ACCESS, MENU_KEYS, isMenuKey } from './permissions';

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
});
