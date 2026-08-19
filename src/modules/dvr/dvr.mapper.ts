import { DvrDetails } from '../../data/accessors/dvr.accessor';
import { DvrDto } from './dto/dvr.dto';

export function toDvrDto(dvr: DvrDetails, cameraCount: number): DvrDto {
  return {
    id: dvr.id,
    url: dvr.url,
    username: dvr.username,
    timezone: dvr.timezone,
    lastTestAt: dvr.lastTestAt,
    lastTestOk: dvr.lastTestOk,
    cameraCount,
    createdAt: dvr.createdAt,
    updatedAt: dvr.updatedAt,
  };
}
