import { ApiProperty } from '@nestjs/swagger';
import { MemberDto } from './member.dto';

export class MemberListDto {
  @ApiProperty({ type: [MemberDto] })
  items!: MemberDto[];

  @ApiProperty({
    description: 'The roster size the screen shows as its subtitle',
  })
  total!: number;
}
