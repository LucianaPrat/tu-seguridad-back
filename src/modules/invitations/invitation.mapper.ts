import { toMemberPermissions } from '../../cross/common/permissions';
import { InvitationRecord } from '../../data/accessors/invitation.accessor';
import { InvitationDto } from './dto/invitation.dto';

export function invitedByName(invitation: InvitationRecord): string {
  const { firstName, lastName } = invitation.invitedBy;
  return `${firstName} ${lastName}`.trim();
}

// The raw token and its hash are deliberately absent: an admin who can read
// this response still cannot log in as the invitee.
export function toInvitationDto(invitation: InvitationRecord): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    ...toMemberPermissions(invitation),
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}
