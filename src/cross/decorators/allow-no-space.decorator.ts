import { SetMetadata } from '@nestjs/common';

export const ALLOW_NO_SPACE_KEY = 'allowNoSpace';

/**
 * Opens a route to a session that is not in any space: a fresh account, or one
 * whose last membership was removed. Only routes that act on the user rather
 * than on a space carry it; everything else stays behind `SpaceMemberGuard`.
 */
export const AllowNoSpace = () => SetMetadata(ALLOW_NO_SPACE_KEY, true);
