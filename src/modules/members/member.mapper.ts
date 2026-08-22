import { SpaceMemberRosterRecord } from '../../data/accessors/space-member.accessor';
import { MemberDto } from './dto/member.dto';

export function toMemberDto(member: SpaceMemberRosterRecord): MemberDto {
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
  };
}
