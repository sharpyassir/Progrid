# First deploy on DigitalOcean

This puts progrid.sa, the console and the API live on one DigitalOcean droplet in Frankfurt.
Customer servers are not possible yet: that needs the dedicated Proxmox machine (see
`docs/hosting.md`). Until then signups work, the console works, and creating resources stops at
the payment step because no Moyasar keys are set.

Time: about one hour, most of it waiting for DNS and the first image build.

## 1. Keys on your laptop

Mac or Linux terminal. On Windows use Ubuntu under WSL.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/progrid -C ops@progrid.sa          # you, with a passphrase
ssh-keygen -t ed25519 -f ~/.ssh/progrid-deploy -N "" -C deploy       # GitHub, no passphrase
```

## 2. The droplet

In DigitalOcean: **Create, Droplets**.

| Setting | Value |
|---|---|
| Region | Frankfurt (FRA1) |
| Image | Ubuntu 24.04 (LTS) x64 |
| Size | Basic, Regular, 2 vCPU, 4 GB, 80 GB to start (4 vCPU, 8 GB once customers arrive) |
| Authentication | SSH key: paste `~/.ssh/progrid.pub` |
| Backups | On, weekly |
| Monitoring | On |
| Hostname | mgmt1-progrid |

When it is ready, note two addresses from the droplet page, **Networking** tab:

- the public IPv4, called `PUBLIC_IP` below
- the private (VPC) IPv4, called `VPC_IP` below

Let GitHub deploy to it:

```bash
ssh -i ~/.ssh/progrid root@PUBLIC_IP 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/progrid-deploy.pub
```

## 3. DNS

Where progrid.sa is registered, add four A records, TTL 300, all pointing at `PUBLIC_IP`:
`@`, `www`, `console`, `api`. Check before going on (all four must print the address):

```bash
for h in progrid.sa www.progrid.sa console.progrid.sa api.progrid.sa; do dig +short $h; done
```

## 4. Images on GitHub

The droplet pulls three images that GitHub Actions builds: `prgd-api`, `prgd-console`,
`prgd-www`.

1. In the repository, **Actions**: the latest `ci` run on main must be green, and a `deploy` run
   must have finished its `images` job after it. If not, open **deploy**, **Run workflow** on main.
2. The repository is private, so the images are private too. Create a GitHub token
   (**Settings, Developer settings, Personal access tokens, Tokens (classic)**) with only the
   `read:packages` scope. It goes in the vault in step 5.

## 5. Ansible settings

```bash
pip install ansible-core
git clone https://github.com/sharpyassir/TurkeyProject.git progrid && cd progrid/infra/ansible
ansible-galaxy install -r requirements.yml
mkdir -p group_vars/all && cp group_vars/all.yml.example group_vars/all/vars.yml
```

`inventory.ini`:

```ini
[management]
mgmt1 ansible_host=PUBLIC_IP mgmt_ip=VPC_IP

[pve_nodes]

[all:vars]
ansible_user=root
ansible_ssh_private_key_file=~/.ssh/progrid
ansible_python_interpreter=/usr/bin/python3
```

In `group_vars/all/vars.yml` change these lines and leave the rest:

```yaml
hypervisor_driver: fake           # until the Proxmox machine exists
mail_provider: log                # resend once step 9 is done
dns_provider: fake                # powerdns later
object_storage_provider: fake     # rgw later
payment_provider: moyasar         # never fake on a public server
```

Secrets. Generate random values:

```bash
for k in postgres_password nats_token jwt_secret secrets_key support_inbound_secret alertmanager_webhook_secret; do echo "vault_$k: $(openssl rand -hex 32)"; done
```

Then `ansible-vault create group_vars/all/vault.yml`, choose a vault password you will keep, and paste:

```yaml
vault_postgres_password: <from above>
vault_nats_token: <from above>
vault_jwt_secret: <from above>
vault_secrets_key: <from above>
vault_support_inbound_secret: <from above>
vault_alertmanager_webhook_secret: <from above>
vault_twilio_auth_token: ""
vault_mail_api_key: ""
vault_resend_webhook_secret: ""
vault_moyasar_secret_key: ""
vault_moyasar_webhook_secret: ""
vault_ghcr_user: <your GitHub username>
vault_ghcr_token: <the token from step 4>
```

Keep a copy of the vault password and the secrets in a password manager. Losing `vault_secrets_key`
makes stored two factor seeds unreadable.

## 6. Run it

```bash
ansible-playbook -i inventory.ini site.yml --ask-vault-pass
```

About ten minutes. It installs Docker, writes `/etc/prgd/prgd.env`, turns on the firewall,
pulls the images, runs migrations, loads the catalog (plans, prices, images) and starts everything.
Caddy fetches TLS certificates on the first request.

## 7. Check

- https://progrid.sa shows the site
- https://console.progrid.sa shows the sign in page
- `curl https://api.progrid.sa/healthz` answers `"status":"ok"`

On the droplet, `cd /opt/prgd && docker compose --env-file /etc/prgd/prgd.env ps` should
list every service as running or healthy.

## 8. Your staff account

Sign up in the console with your own email. With `mail_provider: log` the confirmation link is in
the API log: `docker compose --env-file /etc/prgd/prgd.env logs api | grep verify`. Then:

```bash
ssh -i ~/.ssh/progrid root@PUBLIC_IP
cd /opt/prgd && docker compose --env-file /etc/prgd/prgd.env run --rm staff you@progrid.sa
```

Sign out and in again, turn on two factor sign in under **Security**, and the back office opens.

## 9. Mail (Resend)

**Sending.** In Resend, add the domain progrid.sa with region **eu-west-1** (Ireland). Resend shows
the DNS records to add where progrid.sa is hosted: the DKIM TXT record (`resend._domainkey`), and
the SPF TXT and MX records on the `send` subdomain it uses for bounces. Add them exactly as shown and
wait until the domain reads **Verified**. Create an API key with sending access (full access if the
same key also reads inbound mail, see below) and put it in the vault as `vault_mail_api_key`. In
`group_vars/all/vars.yml` set `mail_provider: resend` (`mail_from` stays
`Progrid <no-reply@progrid.sa>`).

**Receiving support mail.** Mail to support@progrid.sa becomes a ticket, or a reply on an existing
ticket when the subject carries `[#<number>]`.

1. In Resend, open the progrid.sa domain and enable **Receiving**. Add the MX record it shows at the
   root (`@`) of progrid.sa, pointing at Resend's inbound host exactly as Resend displays it, with
   the lowest priority number of any MX on the root. Every address @progrid.sa is then delivered
   to Resend, so do this only if no other mailbox provider serves the root domain; the API only
   turns mail addressed to `support_inbox` (support@progrid.sa) into tickets and ignores the rest.
2. Under **Webhooks**, add an endpoint `https://api.progrid.sa/v1/support/inbound/resend` for the
   event `email.received`. Copy its signing secret (it starts with `whsec_`) into the vault as
   `vault_resend_webhook_secret`.
3. The API fetches the message body from Resend with `vault_mail_api_key`, so that key must be
   allowed to read received emails (a full access key).
4. Run the playbook again (step 6). Send a test mail to support@progrid.sa from the address of a
   user with an account; it appears in the back office support queue. Resend's webhook page shows
   each delivery and the API's answer; retries of the same email never open a second ticket.

The generic endpoint `POST /v1/support/inbound` (guarded by `vault_support_inbound_secret`) still
accepts `{from, subject, text}` from any other relay.

## 10. Deploys from GitHub

Repository **Settings, Secrets and variables, Actions**, new repository secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `PUBLIC_IP` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | the whole content of `~/.ssh/progrid-deploy` |

Also create an environment named `production` under **Settings, Environments** (add yourself as a
required reviewer if you want to approve each deploy). From then on every push to main that
passes CI builds the images and rolls the droplet.

## If something fails

Copy the failing task and its error from the Ansible output, or the output of
`docker compose --env-file /etc/prgd/prgd.env logs --tail 100 api`, and send it over.
