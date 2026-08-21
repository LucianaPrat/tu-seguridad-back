import { SpaceMember, User } from '@prisma/client';
import { MemberDto } from './dto/member.dto';

export function toMemberDto(member: SpaceMember & { user: User }): MemberDto {
  return {
    id: member.user.id,
    email: member.user.email,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    phone: member.user.phone,
    avatarUrl: member.user.avatarUrl,
    isActive: member.user.isActive,
    lastLoginAt: member.user.lastLoginAt,
  };
}
