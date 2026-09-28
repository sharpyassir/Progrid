# @prgd/sdk

TypeScript and JavaScript client for the prgd API. Works in Node 20 and newer and in any runtime with `fetch`.

```sh
npm install @prgd/sdk
```

```ts
import { Prgd } from '@prgd/sdk';

const prgd = new Prgd({ token: process.env.PRGD_TOKEN! });

const sizes = await prgd.catalog.sizes();
const server = await prgd.servers.create({ name: 'web-1', size: 's-1vcpu-1gb', image: 'ubuntu-24-04' });
const ready = await prgd.servers.waitUntilActive(server.id);
console.log(`ssh root@${ready.networks.v4[0].ipAddress}`);

const deploy = await prgd.deploys.create({ repoUrl: 'https://github.com/acme/app', branch: 'main', port: 3000 });
console.log((await prgd.deploys.logs(deploy.id)).log);
```

Every write sends an `Idempotency-Key`, so retrying a call never creates two of anything. Errors are `PrgdError` with `status`, `code`, `message` and `details`; `needsApproval` is true when a person has to approve the request in the console, and `prgd.approvals.wait(id)` polls for the decision.

Types are generated from `packages/openapi/openapi.yaml` with `pnpm gen`; the client methods are written by hand so they read well. Regenerate after changing the spec, then run `pnpm test`.
