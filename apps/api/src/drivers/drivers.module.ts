import { Global, Module } from '@nestjs/common';
import { loadConfig } from '../config/config';
import { NatsService } from '../common/nats/nats.service';
import { FakeDriver } from './fake.driver';
import { FakePlatformAgents } from './fake-platform-agents';
import { setAgentTransport } from '../common/platform-agent';
import { HYPERVISOR_DRIVER } from './hypervisor.driver';
import { ProxmoxDriver } from './proxmox.driver';

/** The platform agent simulator exists only with the fake driver; production never constructs it. */
const fakeAgents = loadConfig().HYPERVISOR_DRIVER === 'fake' ? [FakePlatformAgents] : [];

@Global()
@Module({
  providers: [
    ...fakeAgents,
    FakeDriver,
    ProxmoxDriver,
    {
      provide: HYPERVISOR_DRIVER,
      inject: [FakeDriver, NatsService],
      useFactory: (fake: FakeDriver, nats: NatsService) => {
        if (loadConfig().HYPERVISOR_DRIVER === 'proxmox') return new ProxmoxDriver(nats);
        // Calls to platform agents on :9009 are answered by the simulator instead of HTTP.
        if (fake.agents) setAgentTransport(fake.agents.handle);
        return fake;
      },
    },
  ],
  exports: [HYPERVISOR_DRIVER, ...fakeAgents],
})
export class DriversModule {}
