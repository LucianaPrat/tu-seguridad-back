import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateZoneDto } from './create-zone.dto';

export class UpdateZoneDto extends PartialType(
  OmitType(CreateZoneDto, ['id'] as const),
) {}
