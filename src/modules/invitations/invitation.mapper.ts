import { InvitationRecord } from '../../data/accessors/invitation.accessor';
import { InvitationDto } from './dto/invitation.dto';

// The raw token and its hash are deliberately absent: an admin who can read
// this response still cannot log in as the invitee.
export function toInvitationDto(invitation: InvitationRecord): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}
