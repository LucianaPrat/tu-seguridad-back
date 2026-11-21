/**
 * What gets recorded alongside a refresh token so a session can be recognized
 * later: the client that asked for it. Not identity, and never authorization —
 * both are spoofable — but the difference between "revoke everything" and
 * "revoke that one" when an account is compromised.
 */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}
