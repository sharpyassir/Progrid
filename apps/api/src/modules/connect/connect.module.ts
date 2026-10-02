import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { TrustModule } from '../trust/trust.module';
import { ComputeModule } from '../compute/compute.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { AppPlatformModule } from '../app-platform/app.module';
import { SupportModule } from '../support/support.module';
import { ConnectController } from './connect.controller';
import { ConnectPublicController } from './public.controller';
import { ConnectAdminController } from './admin.controller';
import { AgentsService } from './agents.service';
import { AgentPartsService } from './parts.service';
import { ConnectionsService } from './connections.service';
import { GenerateService } from './generate.service';
import { RunsService } from './runs.service';
import { ConnectUsageService } from './usage.service';
import { ConnectJobs } from './jobs.service';
import { ModelService } from './models/model.service';
import { ToolRegistry } from './tools/registry.service';
import { RunService } from './runtime/run.service';
import { RunEvents } from './runtime/run-events.service';

/**
 * Progrid Connect: AI agents and automations (docs/connect.md). Layers, bottom up: models
 * (ModelService, provider per vendor), tools (ToolRegistry, one executor per kind), connections
 * (credentials), workflows (graph + node executors in RunService), and the Progrid services
 * the progrid tool reaches.
 */
@Module({
  imports: [EventsModule, BillingModule, TrustModule, ComputeModule, MonitoringModule, AppPlatformModule, SupportModule],
  controllers: [ConnectController, ConnectPublicController, ConnectAdminController],
  providers: [ModelService, ToolRegistry, RunEvents, ConnectUsageService, ConnectionsService, RunService, AgentsService, AgentPartsService, GenerateService, RunsService, ConnectJobs],
  exports: [RunService, RunsService, ConnectUsageService],
})
export class ConnectModule {}
