import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { FirewallsService } from './firewalls.service';
import { IpsService } from './ips.service';
import { NetworkController } from './network.controller';
import { PrivateNetworksService } from './private-networks.service';

@Module({
  imports: [EventsModule],
  controllers: [NetworkController],
  providers: [FirewallsService, IpsService, PrivateNetworksService],
  exports: [FirewallsService, IpsService, PrivateNetworksService],
})
export class NetworkModule {}
