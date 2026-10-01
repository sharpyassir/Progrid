# Ansible

Three roles, one playbook. Run it on the management host from the checkout at `/opt/progrid-src`
(the inventory uses `ansible_connection=local` for it and SSH for the nodes).

| Role | Runs on | Does |
|---|---|---|
| `wireguard` | the management host and every Proxmox node | `wg0` on the management network `10.9.0.0/24` (management `.1`, nodes `.2` and up). Keys are generated on each host; only public keys are read back. Opens UDP 51820 in ufw on the management host |
| `management` | the management host or VM | Docker (started after `wg0`), `/opt/prgd` with the compose bundle, `/etc/prgd/prgd.env` from the vault (NATS published on the WireGuard address), ufw, nightly backups, first `deploy.sh` |
| `pve_node` | every Proxmox node | builds `host-agent` from this checkout in a `golang` container on the Ansible machine (version = git sha) and copies it over, the `prgd@pve` user, `PrgdAgent` role and `agent` API token (secret kept on the node in `/etc/prgd/pve-token-secret`), `snippets` on `local`, `/etc/prgd/agent.yaml`, systemd unit |

The first Proxmox node, from the Hetzner rescue system to a test server, is in
`docs/first-proxmox-node.md`.

```sh
pip install ansible-core
ansible-galaxy install -r requirements.yml
cp inventory.example.ini inventory.ini            # fill in hosts, WireGuard addresses
mkdir -p group_vars/all
cp group_vars/all.yml.example group_vars/all/vars.yml  # fill in settings
ansible-vault create group_vars/all/vault.yml          # secrets (see all.yml.example for the keys)
ansible-playbook -i inventory.ini site.yml --ask-vault-pass
```

Re-running is safe. To roll only the control plane images use the GitHub deploy workflow or `sudo /opt/prgd/deploy.sh vX.Y.Z` on the host.
