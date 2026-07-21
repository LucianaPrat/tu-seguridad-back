import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Either } from '../../cross/errors/either';
import { QueryEventsDto } from './dto/query-events.dto';
import { ZoneEventDto } from './dto/zone-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  query(@Query() dto: QueryEventsDto): Promise<Either<ZoneEventDto[]>> {
    return this.eventsService.query(dto);
  }
}
