import type { JwtPayload } from './jwt-payload.type';

/** Spec fixture: an admin principal in `space-uuid`; override what a test varies. */
export const buildPrincipal = (
  overrides: Partial<JwtPayload> = {},
): JwtPayload => ({
  sub: 1,
  email: 'admin@example.com',
  spaceId: 'space-uuid',
  role: 'admin',
  profileCompleted: true,
  menuAccess: ['home', 'monitor', 'events', 'dvr', 'channels', 'members'],
  cameraIds: [],
  receiveAlerts: true,
  ...overrides,
});
