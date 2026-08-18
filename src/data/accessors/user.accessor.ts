import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProfileCompletionFields {
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string | null;
  passwordHash: string;
}

@Injectable()
export class UserAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  updatePassword(id: number, passwordHash: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  completeProfile(id: number, fields: ProfileCompletionFields): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { ...fields, profileCompleted: true },
    });
  }

  recordLogin(id: number, now = new Date()): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: now },
    });
  }
}
