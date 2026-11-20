import { SpaceMemberRole } from '@prisma/client';

/** Sidebar sections a membership can be granted. `profile` and `help` are always visible. */
export const MENU_KEYS = [
  'home',
  'monitor',
  'events',
  'dvr',
  'channels',
  'members',
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export const DEFAULT_MENU_ACCESS: Record<SpaceMemberRole, MenuKey[]> = {
  admin: [...MENU_KEYS],
  collaborator: ['home', 'monitor', 'events', 'dvr', 'channels'],
  guest: ['home', 'monitor'],
};

export function isMenuKey(value: unknown): value is MenuKey {
  return (
    typeof value === 'string' &&
    (MENU_KEYS as readonly string[]).includes(value)
  );
}
