import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { Either } from '../../cross/errors/either';
import { AcknowledgementDto } from '../auth/dto/acknowledgement.dto';
import { AlertEventsService } from './alert-events.service';
import { AlertEventPageDto } from './dto/alert-event-page.dto';
import { AlertEventDto } from './dto/alert-event.dto';
import { EventDeliveryDto } from './dto/event-delivery.dto';
import { InboundAcknowledgementDto } from './dto/inbound-acknowledgement.dto';
import { QueryAlertEventsDto } from './dto/query-alert-events.dto';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class AlertEventsController {
  constructor(private readonly alertEventsService: AlertEventsService) {}

  @Get()
  @ApiOkResponse({ type: AlertEventPageDto })
  query(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryAlertEventsDto,
  ): Promise<Either<AlertEventPageDto>> {
    return this.alertEventsService.query(user.spaceId, query);
  }

  /**
   * The provider webhook. Public because no webhook authentication scheme is
   * chosen yet; the correlation id is the only thing it accepts, and every
   * outcome answers `202 { accepted: true }`.
   */
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('acknowledgements')
  @ApiOkResponse({ type: AcknowledgementDto })
  acknowledge(
    @Body() dto: InboundAcknowledgementDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.alertEventsService.acknowledgeInbound(dto.correlationId);
  }

  @Get(':id')
  @ApiOkResponse({ type: AlertEventDto })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<AlertEventDto>> {
    return this.alertEventsService.findById(user.spaceId, id);
  }

  @Get(':id/deliveries')
  @ApiOkResponse({ type: [EventDeliveryDto] })
  findDeliveries(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<EventDeliveryDto[]>> {
    return this.alertEventsService.findDeliveries(user.spaceId, id);
  }
}
