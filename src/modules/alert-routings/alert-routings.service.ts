import { Injectable } from '@nestjs/common';
import { ALERT_ROUTING_DEFAULTS } from '../../cross/common/constants';
import { buildData, Either } from '../../cross/errors/either';
import { AlertRoutingAccessorService } from '../../data/accessors/alert-routing.accessor';
import { AlertRoutingListDto } from './dto/alert-routing-list.dto';

@Injectable()
export class AlertRoutingsService {
  constructor(
    private readonly alertRoutingAccessor: AlertRoutingAccessorService,
  ) {}

  /**
   * The screen renders a fixed grid, so a space whose defaults were never
   * written still gets six cells instead of a hole: every stored row wins
   * over its default, and every default fills the cells that were never
   * saved.
   */
  async findAll(spaceId: string): Promise<Either<AlertRoutingListDto>> {
    const stored = await this.alertRoutingAccessor.listBySpace(spaceId);

    const items = ALERT_ROUTING_DEFAULTS.map((defaultCell) => {
      const row = stored.find(
        (r) =>
          r.alertType === defaultCell.alertType &&
          r.channel === defaultCell.channel,
      );
      return {
        alertType: defaultCell.alertType,
        channel: defaultCell.channel,
        enabled: row ? row.enabled : defaultCell.enabled,
      };
    });

    return buildData({ items });
  }

  /** Re-reads the full matrix after the write so the answer is never partial. */
  async replace(
    spaceId: string,
    dto: AlertRoutingListDto,
  ): Promise<Either<AlertRoutingListDto>> {
    await this.alertRoutingAccessor.upsertMany(spaceId, dto.items);
    return this.findAll(spaceId);
  }
}
