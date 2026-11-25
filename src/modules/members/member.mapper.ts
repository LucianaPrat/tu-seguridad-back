import { SpaceMemberRosterRecord } from '../../data/accessors/space-member.accessor';
import { toMemberPermissions } from '../../cross/common/permissions';
import { MemberDto } from './dto/member.dto';

export function toMemberDto(
  member: SpaceMemberRosterRecord,
  withPermissions: boolean,
): MemberDto {
  return {
    id: member.user.id,
    email: member.user.email,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    phone: member.user.phone,
    avatarUrl: member.user.avatarUrl,
    isActive: member.user.isActive,
    lastLoginAt: member.user.lastLoginAt,
    profileCompleted: member.user.profileCompleted,
    profileEditable: member.user._count.memberships === 1,
    receiveAlerts: member.receiveAlerts,
    role: member.role,
    ...(withPermissions ? toMemberPermissions(member) : {}),
  };
}
