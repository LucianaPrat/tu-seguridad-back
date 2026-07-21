import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { EnvNames } from '../../cross/common/constants';
import { asExpiresIn } from '../../cross/common/jwt-payload.type';
import { JwtAuthGuard } from '../../cross/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

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
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
