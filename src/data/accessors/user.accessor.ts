import { Injectable } from '@nestjs/common';
import { Locale, LoginMethod, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProfileCompletionFields {
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string | null;
  passwordHash: string;
}

export interface EditableProfileFields {
  locale?: Locale;
  firstName?: string;
  lastName?: string;
  phone?: string;
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

  /** Only the keys present are written; `undefined` leaves a column alone. */
  updateProfile(id: number, fields: EditableProfileFields): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: fields });
  }

  completeProfile(id: number, fields: ProfileCompletionFields): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { ...fields, profileCompleted: true },
    });
  }

  setLastSpaceId(id: number, spaceId: string | null): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastSpaceId: spaceId },
    });
  }

  /** Stamps `lastLoginAt` and appends the history row, atomically. */
  async recordLogin(
    id: number,
    method: LoginMethod,
    now = new Date(),
  ): Promise<User> {
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { lastLoginAt: now } }),
      this.prisma.loginEvent.create({
        data: { userId: id, method, createdAt: now },
      }),
    ]);
    return user;
  }
}
