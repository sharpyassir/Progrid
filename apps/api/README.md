# @pgcloud/api

The control plane: a NestJS modular monolith (`src/app.module.ts`), a Temporal worker
(`src/worker.ts`, workflows in `src/workflows`) and the Prisma schema (`prisma/`). How to run it
locally is in the repository README.

## Tests

`pnpm test` runs the unit tests (`src/**/*.test.ts`). They need nothing running.

### Integration tests

`pnpm test:integration` drives the public HTTP API end to end: accounts, sessions and API
tokens, the prepaid gate and card top ups, servers (power, resize, snapshots, restore,
volumes, moving public addresses), load balancers, one and three node Postgres, Valkey and
MySQL, Kubernetes, App Platform and Git Deploy, hourly rating, the monthly invoice, dunning,
and limited staff with two factor sign in. The suite lives in `test/integration` and has its
own vitest config, so `pnpm test` stays fast.

It boots the API and a Temporal worker with the real workflows and activities in the test
process, with `HYPERVISOR_DRIVER=fake`. The fake driver starts a simulated platform agent for
every VM whose cloud-init installs one (`src/drivers/fake-platform-agents.ts`), so the load
balancer, database, Kubernetes, app host and Git Deploy agents answer on their private address
with the same paths, status codes and shared secret as the Python agents. Scheduled jobs are
stopped; tests run the jobs they need.

It needs:

- Postgres. The suite drops and recreates the database in `IT_DATABASE_URL`
  (default `postgresql://pgcloud:pgcloud@localhost:5432/pgcloud_test`; the name must contain
  "test"), applies every migration and runs the seed. The user must be allowed to create
  databases.
- Redis. The suite empties the database in `IT_REDIS_URL` (default `redis://localhost:6379/5`).
- A Temporal server at `TEMPORAL_ADDRESS` (default `localhost:7233`):
  `temporal server start-dev --headless`. Each run uses a task queue of its own.
- NATS is optional (`NATS_URL`); without it messaging is off, as in local development.

```bash
temporal server start-dev --headless &      # once
cd apps/api
npx prisma generate
pnpm test:integration                        # about three minutes
pnpm test:integration databases              # one file
IT_LOG=log pnpm test:integration             # with the API and worker logs
```

CI runs the same suite in the `integration` job of `.github/workflows/ci.yml`.
