import { ApiProperty } from '@nestjs/swagger';

export class MeDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({ example: 'admin' })
  role!: string;
}
