/**
 * Email uniqueness is global and compared case-insensitively, so every write
 * and every lookup goes through here. A login that skipped it would miss the
 * row a registration with different casing created.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
