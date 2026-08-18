import { SetMetadata } from '@nestjs/common';

export const ALLOW_INCOMPLETE_PROFILE_KEY = 'allowIncompleteProfile';

/**
 * Opens a route to the session an invited user gets before it has a name, phone
 * and password of its own. Only profile completion and reading back the current
 * user carry it; everything else stays behind `ProfileCompletedGuard`.
 */
export const AllowIncompleteProfile = () =>
  SetMetadata(ALLOW_INCOMPLETE_PROFILE_KEY, true);
