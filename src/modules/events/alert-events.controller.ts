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
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AcknowledgementDto } from '../auth/dto/acknowledgement.dto';
import { AlertEventsService } from './alert-events.service';
import { AlertEventPageDto } from './dto/alert-event-page.dto';
import { AlertEventDto } from './dto/alert-event.dto';
import { EventDeliveryDto } from './dto/event-delivery.dto';
import { InboundAcknowledgementDto } from './dto/inbound-acknowledgement.dto';
import { QueryAlertEventsDto } from './dto/query-alert-events.dto';

@ApiTags('events')
@Controller('events')
export class AlertEventsController {
  constructor(private readonly alertEventsService: AlertEventsService) {}

  @Get()
  @ApiOperation({
    summary: 'Page the alert history of the space',
    description:
      'Alerts raised inside the caller space, newest first. Paging is keyset, not ' +
      'offset: send back the `nextCursor` of the previous page, and stop when it comes ' +
      'back `null`. The cursor is opaque — one detection frame writes an event per ' +
      'entered area with the same `detectedAt`, so it carries the event id too and a ' +
      'timestamp of your own will not work in its place. Each item keeps the camera ' +
      'label copied at detection time, so a deleted camera still renders.',
  })
  @ApiOkResponse({
    type: AlertEventPageDto,
    description: 'One page of history, plus the cursor for the next one.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'A cursor this API did not issue, a `limit` over the ceiling, or a malformed `from`.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  query(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryAlertEventsDto,
  ): Promise<Either<AlertEventPageDto>> {
    return this.alertEventsService.query(user.spaceId, query);
  }

  /**
   * Acknowledgement from outside a session. Public because the credential in the
   * body is the whole authorization: a provider holds the delivery's correlation
   * id, an alert email's recipient holds a token derived from it. Every outcome
   * answers `202 { accepted: true }`.
   */
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('acknowledgements')
  @ApiOperation({
    summary: 'Acknowledge an alert with a delivery credential',
    description:
      'Two callers use this route, and the field they send says which. A notification ' +
      'provider sends `correlationId`, the value issued with the delivery, which no ' +
      'other route returns and no message ever carries. The recipient of an alert ' +
      'email sends `token`, the value in the acknowledge link of that mail — the frontend ' +
      'page behind the link posts it here. Exactly one of the two, never both. ' +
      'The first call acknowledges the alert; a repeat, an unknown id and a token ' +
      'that fails its signature are answered identically, so the response reveals ' +
      'no event. Public: no session exists on either path.',
  })
  @ApiAcceptedResponse({
    type: AcknowledgementDto,
    description:
      'Accepted. Same answer for a match, a repeat, an unknown id and a bad token.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Both credentials sent or neither, or one over the maximum token length.',
  })
  acknowledge(
    @Body() dto: InboundAcknowledgementDto,
  ): Promise<Either<AcknowledgementDto>> {
    return this.alertEventsService.acknowledgeInbound(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one alert',
    description:
      'One alert with the camera label and alert type copied at detection time, the ' +
      'snapshot that raised it if one was stored, and who acknowledged it. History is ' +
      'immutable: logically deleting the camera or the zone it names does not change it.',
  })
  @ApiParam({
    name: 'id',
    description: 'Alert event id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ type: AlertEventDto, description: 'The alert.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No alert with that id in the caller space.',
  })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<AlertEventDto>> {
    return this.alertEventsService.findById(user.spaceId, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({
    summary: 'List the delivery attempts of an alert',
    description:
      'One row per channel and recipient the alert was routed to, with its status and ' +
      'the timestamp of any provider callback. Attempts are planned, not yet sent — no ' +
      'provider ships with this API — so they stay `pending`. The correlation id is ' +
      'never in this response: it is what the acknowledgement route accepts, and a ' +
      'member holding it could acknowledge an alert they never received.',
  })
  @ApiParam({
    name: 'id',
    description: 'Alert event id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({
    type: [EventDeliveryDto],
    description: 'Delivery attempts planned for that alert.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No alert with that id in the caller space.',
  })
  findDeliveries(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<EventDeliveryDto[]>> {
    return this.alertEventsService.findDeliveries(user.spaceId, id);
  }
}
