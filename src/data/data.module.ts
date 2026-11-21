import { Global, Module } from '@nestjs/common';
import { CredentialHashService } from '../cross/crypto/credential-hash.service';
import { FieldEncryptionService } from '../cross/crypto/field-encryption.service';
import { PasswordHashService } from '../cross/crypto/password-hash.service';
import { SecretTokenService } from '../cross/crypto/secret-token.service';
import { AlertEventAccessorService } from './accessors/alert-event.accessor';
import { AlertRoutingAccessorService } from './accessors/alert-routing.accessor';
import { AuthTokenAccessorService } from './accessors/auth-token.accessor';
import { CameraAccessorService } from './accessors/camera.accessor';
import { DatabaseHealthAccessor } from './accessors/database-health.accessor';
import { DvrAccessorService } from './accessors/dvr.accessor';
import { EventDeliveryAccessorService } from './accessors/event-delivery.accessor';
import { HitAccessorService } from './accessors/hit.accessor';
import { InvitationAccessorService } from './accessors/invitation.accessor';
import { SnapshotAccessorService } from './accessors/snapshot.accessor';
import { SpaceMemberAccessorService } from './accessors/space-member.accessor';
import { SpaceAccessorService } from './accessors/space.accessor';
import { UserAccessorService } from './accessors/user.accessor';
import { UserFaceIdentityAccessorService } from './accessors/user-face-identity.accessor';
import { MonitorZoneAccessorService } from './accessors/zone.accessor';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    CredentialHashService,
    FieldEncryptionService,
    PasswordHashService,
    SecretTokenService,
    UserAccessorService,
    CameraAccessorService,
    DatabaseHealthAccessor,
    MonitorZoneAccessorService,
    HitAccessorService,
    SpaceAccessorService,
    SpaceMemberAccessorService,
    DvrAccessorService,
    InvitationAccessorService,
    AuthTokenAccessorService,
    UserFaceIdentityAccessorService,
    SnapshotAccessorService,
    AlertRoutingAccessorService,
    AlertEventAccessorService,
    EventDeliveryAccessorService,
  ],
  exports: [
    CredentialHashService,
    FieldEncryptionService,
    PasswordHashService,
    SecretTokenService,
    UserAccessorService,
    CameraAccessorService,
    DatabaseHealthAccessor,
    MonitorZoneAccessorService,
    HitAccessorService,
    SpaceAccessorService,
    SpaceMemberAccessorService,
    DvrAccessorService,
    InvitationAccessorService,
    AuthTokenAccessorService,
    UserFaceIdentityAccessorService,
    SnapshotAccessorService,
    AlertRoutingAccessorService,
    AlertEventAccessorService,
    EventDeliveryAccessorService,
  ],
})
export class DataModule {}
