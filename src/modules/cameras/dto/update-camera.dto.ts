import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCameraDto } from './create-camera.dto';

export class UpdateCameraDto extends PartialType(
  OmitType(CreateCameraDto, ['id'] as const),
) {}
