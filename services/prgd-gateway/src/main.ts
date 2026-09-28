import { loadConfig } from './config';
import { log } from './log';
import { Gateway } from './server';

async function main() {
  const config = loadConfig();
  if (!config.gatewaySecret) log.warn('PRGD_GATEWAY_SECRET is empty; the API refuses every call');
  if (!config.natsUrl) log.warn('NATS_URL is empty; kills arrive only with the next heartbeat answer');
  if (!config.knownHostsFile) log.warn('PRGD_GATEWAY_KNOWN_HOSTS is empty; host keys are trusted on first use and pinned in memory');
  const gateway = new Gateway({ config });
  const port = await gateway.listen();
  log.info('gateway listening', { port, gatewayId: config.gatewayId, api: config.apiUrl, origins: config.allowedOrigins });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('stopping', { signal, sessions: gateway.connections.size });
    const force = setTimeout(() => process.exit(1), 60_000);
    force.unref();
    await gateway.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGHUP', () => {
    try {
      gateway.reloadHostKeys();
      log.info('known_hosts reloaded');
    } catch (e) {
      log.error('known_hosts reload failed; keeping the previous list', { error: (e as Error).message });
    }
  });
}

main().catch((e) => {
  log.error('gateway failed to start', { error: (e as Error).message });
  process.exit(1);
});
