import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildData, Either } from '../../cross/errors/either';
import { ZoneEventAccessorService } from '../../data/accessors/zone-event.accessor';
import { QueryEventsDto } from './dto/query-events.dto';
import { ZoneEventDto } from './dto/zone-event.dto';
import { EventsGateway } from './events.gateway';
import { toZoneEventDto } from './zone-event.mapper';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

@Injectable()
export class EventsService {
  constructor(
    private readonly zoneEventAccessor: ZoneEventAccessorService,
    private readonly gateway: EventsGateway,
  ) {}

  async query(dto: QueryEventsDto): Promise<Either<ZoneEventDto[]>> {
    const events = await this.zoneEventAccessor.query({
      cameraId: dto.cameraId,
      zoneId: dto.zoneId,
      eventType: dto.eventType,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
      limit: clampLimit(dto.limit),
    });
    return buildData(events.map(toZoneEventDto));
  }

  /**
   * Single entry point the detection pipeline (T16) uses: persists the event
   * (idempotent on eventId) then broadcasts it over the /events namespace.
   */
  async emit(
    data: Prisma.ZoneEventUncheckedCreateInput,
  ): Promise<ZoneEventDto> {
    const existing = await this.zoneEventAccessor.findByEventId(data.eventId);
    const event = existing ?? (await this.zoneEventAccessor.create(data));
    const dto = toZoneEventDto(event);
    this.gateway.broadcastZoneEvent(dto);
    return dto;
  }
}
