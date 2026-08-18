import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

/**
 * Imports `AuthModule` for session issuance and the credential-delivery port:
 * acceptance logs the invitee in, and both modules must hand out sessions the
 * same way. The dependency runs one way only.
 */
@Module({
  imports: [AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
