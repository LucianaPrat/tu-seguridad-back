import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { MENU_KEYS, MenuKey } from '../../../cross/common/permissions';

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: SpaceMemberRole })
  @IsOptional()
  @IsEnum(SpaceMemberRole)
  role?: SpaceMemberRole;

  @ApiPropertyOptional({
    enum: MENU_KEYS,
    isArray: true,
    description:
      'Replaces the list. When only `role` changes, reset to that role defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MENU_KEYS, { each: true })
  menuAccess?: MenuKey[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the list. Cameras of this space; only read for guests.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cameraIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  receiveAlerts?: boolean;
}
