# Key management: secrets at rest, rotation and the audit log

Scope: the control plane API and worker (`apps/api`). ISO 27001 A.8.24 (use of cryptography),
A.8.15 (logging), A.5.33 (protection of records), A.8.10 (information deletion); NCA ECC 2-7, 2-12.

## What is encrypted

Secrets the platform must be able to read back (it sends them to platform VMs or shows them once
more to the customer) are sealed with AES-256-GCM before they are written to Postgres
(`src/common/crypto/secretbox.ts`). Passwords of people, API tokens and session tokens are never
stored at all (argon2 / sha256 hashes).

| Table (Prisma model) | Columns |
| --- | --- |
| `prgd_users` (user) | `totpSecret` |
| `prgd_webhooks` (webhook) | `secret` |
| `prgd_db_clusters` (dbCluster) | `adminPassword`, `vmSecret`, `backupSecretKey` |
| `prgd_db_users` (dbUser) | `password` |
| `prgd_kube_clusters` (kubeCluster) | `vmSecret`, `joinToken`, `certKey`, `kubeconfig`, `backupSecretKey` |
| load balancers, app hosts | `vmSecret` |
| `prgd_platform_apps` (platformApp) | `gitToken`, `envVars` (stored as `{"enc": "<sealed JSON>"}`) |
| `prgd_deployments` (deployment) | `webhookSecret`, `vmSecret`, `envVars` (as above) |
| `prgd_storage_keys` (storageKey) | `secretKey` |
| `prgd_servers` (server) | `userData` (rendered cloud-init: agent secrets, app variables; opened only to hand it to the hypervisor) |
| ops, Connect, affiliates | SSH CA key, local secret store, connection secrets, agent variables, webhook signing secrets, payout details, TINs |

The full list the reseal tool walks is `SEALED_COLUMNS` in `src/cli/reseal.ts`; a new sealed
column must be added there.

Values written before encryption existed are still read as plain text (`open()` passes through
anything without the `enc:` prefix) and are sealed by the reseal tool.

## Formats and keys

* `enc:v2:<kid>:<iv>:<tag>:<ciphertext>`: current format. The AES key is
  `HKDF-SHA256(key material, info "prgd/enc/v2")` of keyring entry `<kid>`.
* `enc:v1:<iv>:<tag>:<ciphertext>`: legacy, keyed with `sha256(SECRETS_KEY or JWT_SECRET)`. Read
  only (plus new writes while no keyring is configured).

Configuration:

* `SECRETS_KEYS="k2:<base64>,k1:<base64>"`: the keyring. The **first** entry is the active key that
  new values are sealed with; the others are only used to read older values. Key material is 64
  hex characters, base64 of 32+ bytes, or (discouraged) a plain string.
* `SECRETS_KEY=<key>`: shorthand for a one key ring with kid `k1`. It also stays the legacy (v1)
  key material, so a deployment that already had `SECRETS_KEY` keeps reading its v1 values.
* `SECRETS_LEGACY_KEY`: optional. Pins the material of the legacy key (v1 values and keyed hashes)
  so `JWT_SECRET` or `SECRETS_KEY` can change without losing them. Set it to the old
  `SECRETS_KEY` (or old `JWT_SECRET` if `SECRETS_KEY` was never set) before changing either.
* Neither set: development and tests use the legacy derivation from `JWT_SECRET`. In production the
  API logs a loud `SECURITY:` error at the first seal/open and keeps the legacy behaviour (it does
  not refuse to start, so an existing installation is not taken down by an upgrade).

`keyedHash()` (affiliate click addresses, Moyasar card fingerprints) deliberately stays on the
legacy key: the hashes are persisted and compared with later hashes (one click per address per
day, the same card across teams), so switching it to a rotating key would silently break those
matches. `keyedHashV2()` (HKDF info `prgd/hmac/v2`) is available for new uses that are not looked
up across rotations.

Production refuses to start (loadConfig) when `JWT_SECRET`, `SECRETS_KEY`, any `SECRETS_KEYS`
entry, `NATS_TOKEN`, `PRGD_GATEWAY_SECRET` or `PRGD_PLATFORM_HEARTBEAT_SECRET` is set to a value
containing `change-me` or shorter than 32 characters, or when `JWT_SECRET` equals an encryption key.

## Where keys live

* Source of truth: the Ansible vault (`infra/ansible/group_vars/*/vault.yml`, encrypted with
  `ansible-vault`), variables `vault_jwt_secret`, `vault_secrets_key` and, for the keyring,
  `vault_secrets_keys`. The management role renders them into `/etc/prgd/prgd.env` (mode 0600,
  owner root) which the API and worker containers read.
* Never in git in clear, never in CI variables of forks, never in tickets or chat. The vault
  password is held by the security owner and one deputy (see roles-and-responsibilities.md).
* Backups of the database contain only sealed values; the keys are backed up separately (vault).
  A database backup without the keyring is useless, and so is a keyring without the backup:
  keep the old key entries for as long as backups sealed with them are retained.

## Generating a key

```sh
openssl rand -base64 32        # 32 random bytes, base64 (44 characters)
```

Kids are short labels; use the date: `k2026a`, `k2026b`.

## First rollout (production with only JWT_SECRET or SECRETS_KEY)

1. Generate a key. In the vault set
   `vault_secrets_keys: "k2026a:<new key>"` and, if `SECRETS_KEY` was never set,
   `vault_secrets_legacy_key: <current JWT_SECRET>` (rendered as `SECRETS_LEGACY_KEY`); if
   `SECRETS_KEY` was set, keep it as it is.
2. Deploy (API and worker restart). New values are sealed `enc:v2:k2026a:`; old v1 and plain
   values are still read.
3. Run the reseal in the API container: `node dist/cli/reseal.js --dry-run`, then
   `node dist/cli/reseal.js`. It is idempotent and may run while the API serves traffic.
4. When it reports 0 rows everywhere, v1 is no longer needed for sealed columns. Keep
   `SECRETS_LEGACY_KEY` / `SECRETS_KEY` for `keyedHash` values.

Rollback note: an API version from before this change cannot read `enc:v2` values. Roll back only
together with a restore, or not after step 2.

## Rotation (yearly, and at once on suspected compromise or when someone with vault access leaves)

1. Generate a new key and put it **first**: `SECRETS_KEYS="k2027a:<new>,k2026a:<old>"`.
2. Deploy. New writes use `k2027a`; `k2026a` values are still readable.
3. `node dist/cli/reseal.js` re-encrypts every sealed column to `k2027a`.
4. Check with `--dry-run` that nothing is left, then remove `k2026a` from `SECRETS_KEYS` at the next
   deploy **only after** the database backups that still contain `k2026a` values have expired
   (backup retention), otherwise keep it as a read only entry.
5. Record the rotation (date, kids, operator) in the ISMS evidence folder.

A value sealed with a kid that is not in the ring fails to open with an error that names the kid.

## Destruction

When a key is retired: remove it from the vault (`ansible-vault edit`), redeploy so no process
holds it, and record the destruction (kid, date, who, confirmation that no backup within
retention depends on it). Rotate the vault password if the person retiring keys leaves.
Deleting customer data does not need key destruction: the rows are deleted (or for accounts,
anonymised, see DELETE /v1/account) and age out of backups with backup retention.

## Audit log

* Every state changing request under `/v1`, `/admin/v1` and `/ops/v1`, and every staff read under
  `/admin/v1`, is recorded (action `http.<METHOD> <route pattern>`, actor, token, path parameters,
  status code, client address, user agent, duration). Bodies are never recorded. Domain events
  (`server.created`, `database.credentials_viewed`, `app.env_viewed`, `user.deleted`...) are
  recorded next to them.
* Tamper evidence: rows carry `seq`, `prevHash` and `hash = sha256(prevHash + "\n" + canonical row)`.
  Writers serialise on a Postgres advisory lock. Check with `GET /admin/v1/audit/verify` or
  `node dist/cli/verify-audit-chain.js` (exit 2 when broken). Run it daily from monitoring.
* The table refuses `UPDATE`, `DELETE` and `TRUNCATE` (trigger `prgd_audit_logs_append_only`). Only a
  transaction that sets `prgd.audit_purge = 'on'` (the retention job) may delete. A database
  superuser can still disable the trigger; database superuser access is itself restricted and
  logged by Postgres.
* Retention: `AUDIT_RETENTION_DAYS` (default 400). The daily job (03:50 UTC) exports rows past the
  cutoff as gzip JSONL (with their hashes, so the chain can be checked across archives) to the
  platform bucket `AUDIT_ARCHIVE_BUCKET`, then deletes them. Without a bucket nothing is deleted
  unless `AUDIT_PURGE_WITHOUT_ARCHIVE=true`. The first remaining row is the new chain anchor.
* The same job deletes webhook deliveries after 90 days, Connect run steps and run payloads 90 days
  after the run finished (run rows and their usage stay for billing), and console sessions 30 days
  after they expired or were revoked.
