# Ansible

Two roles, one playbook.

| Role | Runs on | Does |
|---|---|---|
| `management` | the management host or VM | Docker, `/opt/pgcloud` with the compose bundle, `/etc/pgcloud/pgcloud.env` from the vault, ufw, nightly backups, first `deploy.sh` |
| `pve_node` | every Proxmox node | `host-agent` binary from the GitHub release, `/etc/pgcloud/agent.yaml`, systemd unit, `pgcloud@pve` API token check |

```sh
pip install ansible-core
ansible-galaxy install -r requirements.yml
cp inventory.example.ini inventory.ini            # fill in hosts
mkdir -p group_vars/all
cp group_vars/all.yml.example group_vars/all/vars.yml  # fill in settings
ansible-vault create group_vars/all/vault.yml          # secrets (see all.yml.example for the keys)
ansible-playbook -i inventory.ini site.yml --ask-vault-pass
```

Re-running is safe. To roll only the control plane images use the GitHub deploy workflow or `sudo /opt/pgcloud/deploy.sh vX.Y.Z` on the host.
