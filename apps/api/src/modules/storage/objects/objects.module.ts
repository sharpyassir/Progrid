import { Module } from '@nestjs/common';
import { TrustModule } from '../../trust/trust.module';
import { loadConfig } from '../../../config/config';
import { EventsModule } from '../../events/events.module';
import { BucketsController, FakeS3Controller, StorageKeysController } from './objects.controller';
import { ObjectsService } from './objects.service';
import { FakeObjectStorage, OBJECT_STORAGE_PROVIDER, RgwObjectStorage } from './objects.provider';

@Module({
  imports: [TrustModule, EventsModule],
  controllers: [BucketsController, StorageKeysController, FakeS3Controller],
  providers: [
    ObjectsService,
    {
      provide: OBJECT_STORAGE_PROVIDER,
      useFactory: () => {
        const cfg = loadConfig();
        if (cfg.OBJECT_STORAGE_PROVIDER === 'rgw') {
          if (!cfg.RGW_ADMIN_URL || !cfg.RGW_ADMIN_ACCESS_KEY || !cfg.RGW_ADMIN_SECRET_KEY) throw new Error('RGW_ADMIN_URL, RGW_ADMIN_ACCESS_KEY and RGW_ADMIN_SECRET_KEY are required when OBJECT_STORAGE_PROVIDER=rgw');
          return new RgwObjectStorage(cfg.RGW_ADMIN_URL, cfg.S3_ENDPOINT, cfg.S3_REGION, cfg.RGW_ADMIN_ACCESS_KEY, cfg.RGW_ADMIN_SECRET_KEY);
        }
        return new FakeObjectStorage(cfg.S3_ENDPOINT, cfg.JWT_SECRET);
      },
    },
  ],
  exports: [ObjectsService, OBJECT_STORAGE_PROVIDER],
})
export class ObjectsModule {}
