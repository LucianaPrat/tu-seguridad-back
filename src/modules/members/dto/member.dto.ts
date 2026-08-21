import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One row of the space roster the Members screen renders.
 */
export class MemberDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ example: '+5491122334455' })
  phone!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: "Null until the member's first login",
  })
  lastLoginAt!: Date | null;
}
