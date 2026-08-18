import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { EnvNames } from '../../cross/common/constants';
import { asExpiresIn } from '../../cross/common/jwt-payload.type';
import { JwtAuthGuard } from '../../cross/guards/jwt-auth.guard';
import { ProfileCompletedGuard } from '../../cross/guards/profile-completed.guard';
import { RolesGuard } from '../../cross/guards/roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CredentialDeliveryPort } from './credential-delivery.port';
import { CredentialRecoveryController } from './credential-recovery.controller';
import { CredentialRecoveryService } from './credential-recovery.service';
import { FaceIdentityController } from './face-identity.controller';
import { FaceIdentityService } from './face-identity.service';
import { LoggedCredentialDeliveryService } from './logged-credential-delivery.service';
import { RefreshCookieService } from './refresh-cookie.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(EnvNames.JWT_SECRET),
        signOptions: {
          expiresIn: asExpiresIn(config.get<string>(EnvNames.JWT_EXPIRES_IN)!),
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    CredentialRecoveryController,
    FaceIdentityController,
  ],
  providers: [
    AuthService,
    SessionService,
    CredentialRecoveryService,
    FaceIdentityService,
    RefreshCookieService,
    // Until a mail provider is chosen, delivery is a logging placeholder. The
    // port is what the domain depends on, so swapping it touches this line only.
    {
      provide: CredentialDeliveryPort,
      useClass: LoggedCredentialDeliveryService,
    },
    // Authentication first, then authorization, then the profile-completion gate.
    // All three are global: the route someone forgets to decorate is the one that
    // leaks, so protection is the default and `@Public()` is the exception.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ProfileCompletedGuard },
  ],
  exports: [
    JwtModule,
    SessionService,
    RefreshCookieService,
    CredentialDeliveryPort,
  ],
})
export class AuthModule {}
