import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** Body of the magic-link and password-reset request routes. */
export class EmailRequestDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email!: string;
}
