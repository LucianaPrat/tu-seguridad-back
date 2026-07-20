import { Global, Module } from '@nestjs/common';
import { CameraAccessorService } from './accessors/camera.accessor';
import { HitAccessorService } from './accessors/hit.accessor';
import { UserAccessorService } from './accessors/user.accessor';
import { ZoneEventAccessorService } from './accessors/zone-event.accessor';
import { ZoneAccessorService } from './accessors/zone.accessor';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    UserAccessorService,
    CameraAccessorService,
    ZoneAccessorService,
    ZoneEventAccessorService,
    HitAccessorService,
  ],
  exports: [
    PrismaService,
    UserAccessorService,
    CameraAccessorService,
    ZoneAccessorService,
    ZoneEventAccessorService,
    HitAccessorService,
  ],
})
export class DataModule {}
