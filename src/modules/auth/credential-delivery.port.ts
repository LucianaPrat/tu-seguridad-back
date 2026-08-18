/**
 * Outbound delivery of a raw one-time credential (invitation link, magic link,
 * password reset). The provider itself is out of scope for the data-model plan,
 * so the domain depends on this port and nothing else: swapping in a real mail
 * provider replaces the implementation, not a single caller.
 *
 * Declared as an abstract class rather than an interface because an interface is
 * erased at runtime and cannot be a DI token.
 */
export type DeliveredCredentialPurpose =
  'invitation' | 'magic_link' | 'password_reset';

export interface CredentialDelivery {
  purpose: DeliveredCredentialPurpose;
  email: string;
  token: string;
  expiresAt: Date;
}

export abstract class CredentialDeliveryPort {
  abstract deliver(delivery: CredentialDelivery): Promise<void>;
}
