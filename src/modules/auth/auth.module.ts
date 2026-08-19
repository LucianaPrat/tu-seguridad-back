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
import { SmtpCredentialDeliveryService } from './smtp-credential-delivery.service';

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
    // Mail is opt-in. With MAIL_ENABLED the credential goes out over SMTP;
    // without it delivery stays the logging placeholder, so a machine with no
    // relay — CI included — behaves exactly as it did before a transport existed.
    // The port is what the domain depends on, so the choice lives on this line
    // only. Both implementations take nothing but ConfigService, hence the
    // direct construction instead of two more providers.
    {
      provide: CredentialDeliveryPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<boolean>(EnvNames.MAIL_ENABLED)
          ? new SmtpCredentialDeliveryService(config)
          : new LoggedCredentialDeliveryService(config),
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
