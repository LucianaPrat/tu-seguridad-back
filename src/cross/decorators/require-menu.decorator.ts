import { SetMetadata } from '@nestjs/common';
import type { MenuKey } from '../common/permissions';

export const REQUIRE_MENU_KEY = 'requiredMenu';

/**
 * Declares the sidebar section a route belongs to. Read by `RolesGuard`: admins
 * always pass, everyone else needs the key in their membership's `menuAccess`.
 */
export const RequireMenu = (key: MenuKey) => SetMetadata(REQUIRE_MENU_KEY, key);
