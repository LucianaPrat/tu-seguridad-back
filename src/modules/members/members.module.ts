import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MemberActivityService } from './member-activity.service';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController],
  providers: [MembersService, MemberActivityService],
})
export class MembersModule {}
