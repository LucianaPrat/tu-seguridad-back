import { ApiProperty } from '@nestjs/swagger';
import { InvitationDto } from './invitation.dto';

export class InvitationListDto {
  @ApiProperty({ type: [InvitationDto] })
  items!: InvitationDto[];

  @ApiProperty()
  total!: number;
}
