import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({ imports: [EventsModule], controllers: [LegalController], providers: [LegalService], exports: [LegalService] })
export class LegalModule {}
