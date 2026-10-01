# First Proxmox node (Hetzner, single node lab)

This runbook turns the Hetzner Server Auction machine (Intel i7-6700, 64 GB RAM, 2 x 512 GB NVMe,
one IPv4 address, booted into the rescue system) into a Proxmox VE 8 node that the control plane
on the DigitalOcean droplet drives through the host agent. Do the steps in order, one at a time.
Every command is meant to be pasted as is after you replace the placeholders.

Time: about three hours, most of it waiting for installs and reboots.

## What you end up with

```
 DigitalOcean droplet (mgmt1)                         Hetzner node (pve1)
 public 164.90.240.114                                public NODE_IP
 ┌─────────────────────────────┐   WireGuard UDP     ┌──────────────────────────────────────┐
 │ wg0 10.9.0.1                │◀═══════════════════▶│ wg0 10.9.0.2                         │
 │ NATS published on           │   10.9.0.0/24       │ host-agent ── NATS ──▶ 10.9.0.1:4222 │
 │   10.9.0.1:4222             │                     │ host-agent ── API ───▶ 127.0.0.1:8006│
 │ API, worker, console ...    │                     │                                      │
 └─────────────────────────────┘                     │ NIC: NODE_IP/32, pointopoint GATEWAY │
                                                     │ vmbr0: routed bridge, SUBNET_GW/29   │
                                                     │   └─ net1 of every server (public)   │
                                                     │ customers: isolated bridge           │
                                                     │   └─ net0 of every server (private)  │
                                                     │ storage vm-disks: LVM thin on RAID 1 │
                                                     └──────────────────────────────────────┘
```

- **Management network.** The node cannot reach the droplet's DigitalOcean private address
  (10.114.0.2), so the two talk over WireGuard on `10.9.0.0/24`: the droplet is `10.9.0.1`, nodes are
  `10.9.0.2` and up. That range sits inside `control_plane_cidr` (`10.0.0.0/12`) and clear of the
  tenant pool (`10.96.0.0/12`), the DigitalOcean VPC (`10.114.0.0/20`), Docker's `172.16.0.0/12` and
  the `10.8.0.0/24` range the docs use for managed customer assets. NATS is published only on
  `10.9.0.1`, so only WireGuard peers can reach it. The terminal gateway and the maintenance runner
  (both containers on the droplet) will later use the same tunnel to reach nodes: their traffic
  leaves through `wg0` from `10.9.0.1`, which is the value for `prgd_gateway_source_addresses`
  (`10.9.0.1/32`).
- **Public addresses, routed.** Hetzner only accepts packets from the server's own MAC address
  on the main IP. A bridged setup, where each VM shows its own MAC on the wire, needs a "virtual
  MAC" per address from Hetzner, and those exist only for single additional IPs, not for subnets.
  So nothing is bridged to the physical NIC: the main IP sits on the NIC itself, the additional
  subnet is routed by Hetzner to the main IP, and the node routes it on to `vmbr0`, a bridge with
  no physical port where the servers' public NICs live. Every packet leaves with the server's own
  MAC, so there is nothing for Hetzner to block and no virtual MACs to manage. The servers'
  gateway is the node's address on `vmbr0`.
- **Private networks.** The platform default `PRIVATE_NETWORK_MODE=shared_bridge` puts every
  server's private NIC on the bridge `customers`, an isolated bridge with no uplink. Per project
  VXLAN VNets (`sdn_vnet`) are not needed on one node; see step 37 for later.
- **Storage.** See "Why LVM thin" at the end.

Placeholders used below. Write yours down as you find them:

| Placeholder | Meaning | Example |
|---|---|---|
| `NODE_IP` | the server's main IPv4 (Hetzner Robot, server page) | `198.51.100.20` |
| `GATEWAY` | Hetzner's gateway for it (step 3) | `198.51.100.1` |
| `NIC` | the network interface name (step 3) | `enp0s31f6` |
| `SUBNET` | the additional IPv4 subnet once ordered (step 30) | `203.0.113.8/29` |
| `SUBNET_GW` | the first usable address of `SUBNET`, kept by the node as the servers' gateway | `203.0.113.9` |

## Part 1: install Debian 12 from the Hetzner rescue system

1. **Keep the rescue login.** In Hetzner Robot the server should show the rescue system as active
   (the order put it there). If it does not: Robot, **Servers**, the server, **Rescue**, choose
   **Linux**, **64 bit**, select your SSH key, **Activate rescue system**, then the **Reset** tab,
   **Execute an automatic hardware reset**. Wait two minutes.

2. **Log in to the rescue system** from your laptop:

   ```bash
   ssh root@NODE_IP
   ```

   If you get a host key warning, the rescue system has a new key each time:
   `ssh-keygen -R NODE_IP` and try again.

3. **Write down the network facts.** In the rescue shell:

   ```bash
   ip -4 -br addr show | grep -v '^lo'      # first column is NIC, second is NODE_IP/prefix
   ip -4 route show default                  # "default via GATEWAY dev NIC"
   lsblk -d -o NAME,SIZE,MODEL               # expect nvme0n1 and nvme1n1, about 476.9G each
   ```

   Note `NIC` and `GATEWAY`. The rescue system usually names the NIC `eth0`; the installed system
   uses the predictable name (for example `enp0s31f6`). You will read the final name in step 6.

4. **Run installimage.**

   ```bash
   installimage
   ```

   In the menu choose **Debian**, then the newest **Debian-12xx-bookworm-amd64-base** image. An
   editor opens with the configuration. Change these lines (leave the others as they are; if the
   file has a `PART /boot/efi esp 256M` line, keep it):

   ```text
   DRIVE1 /dev/nvme0n1
   DRIVE2 /dev/nvme1n1
   SWRAID 1
   SWRAIDLEVEL 1
   HOSTNAME pve1

   PART /boot ext3 1024M
   PART lvm   vg0  all

   LV vg0 root /    ext4 80G
   LV vg0 swap swap swap 8G
   ```

   Delete every other `PART` and `LV` line that was there. This gives software RAID 1 over both
   NVMe drives, a 1 GB `/boot`, and one LVM volume group `vg0` with an 80 GB root and 8 GB of swap.
   The rest of `vg0` (about 385 GB) stays empty on purpose: step 13 turns it into the thin pool for
   VM disks. Save and quit (`F10` in the editor, or `Ctrl+X` then `Y` if it is nano). Confirm the
   warning that all data is erased. The install takes about five minutes.

5. **Reboot into Debian.**

   ```bash
   reboot
   ```

   Wait two minutes, then from your laptop:

   ```bash
   ssh-keygen -R NODE_IP
   ssh root@NODE_IP
   ```

   installimage copied the rescue system's SSH keys, so the same key logs you in.

6. **Check the disks and the network name.**

   ```bash
   cat /proc/mdstat           # md0 and md1, both [UU]; a resync may still be running, that is fine
   vgs                        # vg0 with about 385g VFree
   lvs                        # root and swap
   ip -4 -br addr show | grep -v '^lo'
   ```

   The NIC name shown now is the `NIC` placeholder from here on.

## Part 2: Proxmox VE 8 on Debian 12

These steps follow the official "Install Proxmox VE on Debian 12 Bookworm" guide.

7. **Make the hostname resolve to the main IP.** Proxmox refuses to install when the hostname
   points at `127.0.1.1`.

   ```bash
   hostnamectl set-hostname pve1
   sed -i '/pve1/d' /etc/hosts
   echo "NODE_IP pve1.progrid.sa pve1" >> /etc/hosts
   hostname --ip-address          # must print NODE_IP and nothing else
   ```

8. **Add the Proxmox VE no-subscription repository and its key.**

   ```bash
   echo "deb [arch=amd64] http://download.proxmox.com/debian/pve bookworm pve-no-subscription" > /etc/apt/sources.list.d/pve-install-repo.list
   wget https://enterprise.proxmox.com/debian/proxmox-release-bookworm.gpg -O /etc/apt/trusted.gpg.d/proxmox-release-bookworm.gpg
   sha512sum /etc/apt/trusted.gpg.d/proxmox-release-bookworm.gpg
   ```

   The checksum must be
   `7da6fe34168adc6e479327ba517796d4702fa2f8b4f0a9833f5ea6e6b48f6507a6da403a274fe201595edc86a84463d50383d07f64bdde2e3658108db7d6dc87`.
   If it is not, stop and ask.

9. **Update and install the Proxmox kernel.**

   ```bash
   apt update && apt full-upgrade -y
   apt install -y proxmox-default-kernel
   reboot
   ```

   Log in again after two minutes (`ssh root@NODE_IP`) and check `uname -r` ends in `-pve`.

10. **Install Proxmox VE.**

    ```bash
    apt install -y proxmox-ve postfix open-iscsi chrony
    ```

    When postfix asks, choose **Local only** and keep the suggested mail name. This also replaces
    `ifupdown` with `ifupdown2`, which Proxmox needs for its network and SDN features. If your SSH
    session drops during this step, wait five minutes and log in again; if you cannot, use the
    rescue system (step 1) and ask for help.

11. **Remove the Debian kernel and os-prober.**

    ```bash
    apt remove -y linux-image-amd64 'linux-image-6.1*'
    update-grub
    apt remove -y os-prober
    ```

12. **Remove the enterprise repositories** (they need a paid subscription and make `apt update` fail):

    ```bash
    rm -f /etc/apt/sources.list.d/pve-enterprise.list /etc/apt/sources.list.d/ceph.list
    apt update
    reboot
    ```

    After the reboot, the web interface is at `https://NODE_IP:8006` (user `root`, realm
    `Linux PAM`, your root password; set one with `passwd` if you only use keys). It shows a
    "No valid subscription" message at login. That message is harmless and removing it is
    optional; we leave it. Step 15 closes port 8006 to the internet, so after that open the web
    interface through SSH: `ssh -L 8006:127.0.0.1:8006 root@NODE_IP`, then `https://localhost:8006`.

13. **Create the thin pool and the `vm-disks` storage.**

    ```bash
    lvcreate -l 95%FREE --thinpool data vg0
    pvesm add lvmthin vm-disks --vgname vg0 --thinpool data --content images,rootdir
    pvesm status
    ```

    `pvesm status` lists `local` (directory, `/var/lib/vz`) and `vm-disks` (lvmthin), both active.
    The 5 percent left free in `vg0` is room for the thin pool's metadata to grow.

## Part 3: network

14. **Write the network configuration.** Copy the current file first, then schedule an automatic
    undo in five minutes, so a mistake cannot lock you out:

    ```bash
    cp /etc/network/interfaces /root/interfaces.before
    systemd-run --on-active=5min --unit=net-undo /bin/sh -c 'cp /root/interfaces.before /etc/network/interfaces && ifreload -a'
    ```

    Open `/etc/network/interfaces` (`nano /etc/network/interfaces`). Keep any `iface NIC inet6`
    block installimage wrote (IPv6), and replace the IPv4 part so the file looks like this, with
    your values:

    ```text
    source /etc/network/interfaces.d/*

    auto lo
    iface lo inet loopback

    # Main IP on the NIC itself. Nothing is bridged to it: Hetzner drops unknown MAC addresses.
    auto NIC
    iface NIC inet static
        address NODE_IP/32
        gateway GATEWAY
        pointopoint GATEWAY

    # (keep installimage's "iface NIC inet6 static" block here if it wrote one)

    # Public bridge for customer servers (their net1). Routed: no physical port.
    # Step 31 gives it SUBNET_GW once the additional subnet exists.
    auto vmbr0
    iface vmbr0 inet manual
        bridge-ports none
        bridge-stp off
        bridge-fd 0

    # Shared private bridge for customer servers (their net0). Isolated: no port, no address.
    auto customers
    iface customers inet manual
        bridge-ports none
        bridge-stp off
        bridge-fd 0
    ```

    Apply it and check:

    ```bash
    ifreload -a
    ip -4 addr show NIC          # NODE_IP/32 peer GATEWAY/32
    ip route                     # "default via GATEWAY dev NIC"
    ip -br link show vmbr0 customers
    ping -c 3 1.1.1.1
    ```

    If all of that works, cancel the undo:

    ```bash
    systemctl stop net-undo.timer
    ```

    If something did not work, wait: after five minutes the old file comes back by itself. Then
    reboot once to be sure the configuration survives (`reboot`, log in again, `ping -c 3 1.1.1.1`).

15. **Turn on IP forwarding and the Proxmox firewall.** Forwarding lets the node route the public
    subnet to the servers. The datacenter firewall must be on, or the per server firewall and the
    IP filter that the agent configures are not enforced. The rules allow SSH from anywhere,
    WireGuard, ping, and the Proxmox web interface and API only from the management network.

    ```bash
    echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/80-prgd-forward.conf
    sysctl --system | grep ip_forward
    mkdir -p /etc/pve/firewall
    cat > /etc/pve/firewall/cluster.fw <<'EOF'
    [OPTIONS]
    enable: 1
    policy_in: DROP
    policy_out: ACCEPT

    [RULES]
    IN ACCEPT -p tcp -dport 22 -log nolog
    IN ACCEPT -p udp -dport 51820 -log nolog
    IN ACCEPT -source 10.9.0.0/24 -p tcp -dport 8006 -log nolog
    IN ACCEPT -p icmp -log nolog
    EOF
    pve-firewall restart
    pve-firewall status         # "enabled/running"
    ```

    Open a second SSH session to the node now to prove SSH still works before you close the first.

16. **Harden SSH** (keys only):

    ```bash
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    systemctl reload ssh
    ```

## Part 4: the golden image

The platform's `ubuntu-24-04` image clones Proxmox template VMID 9000 on the node. Build it once.
Boot detection relies on the QEMU guest agent inside the image, so it is installed here.

17. **Build template 9000 (Ubuntu 24.04).**

    ```bash
    apt install -y libguestfs-tools
    cd /root
    wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
    virt-customize -a noble-server-cloudimg-amd64.img --install qemu-guest-agent --truncate /etc/machine-id
    qm create 9000 --name ubuntu-24-04 --memory 2048 --cores 2 --ostype l26 \
      --scsihw virtio-scsi-pci --net0 virtio,bridge=customers \
      --agent enabled=1 --serial0 socket --vga serial0
    qm set 9000 --scsi0 vm-disks:0,import-from=/root/noble-server-cloudimg-amd64.img
    qm set 9000 --ide2 vm-disks:cloudinit --boot order=scsi0
    qm template 9000
    qm config 9000              # scsi0 and ide2 on vm-disks, template: 1
    ```

    The other seeded images (`ubuntu-22-04` 9001, `debian-12` 9002, `rocky-9` 9003) work the same
    way with their cloud images; until they exist, only offer Ubuntu 24.04 (back office, Images:
    untick Available on the others).

## Part 5: connect the node to the control plane

18. **Give the droplet SSH access to the node.** On the droplet (`ssh root@164.90.240.114`):

    ```bash
    ssh-keygen -t ed25519 -f /root/.ssh/progrid_pve -N "" -C ansible@mgmt1
    cat /root/.ssh/progrid_pve.pub
    ```

    Copy the line it prints. On the node:

    ```bash
    echo 'PASTE_THE_LINE_HERE' >> /root/.ssh/authorized_keys
    ```

    Back on the droplet, connect once and answer `yes` to the host key question:

    ```bash
    ssh -i /root/.ssh/progrid_pve root@NODE_IP hostname      # prints pve1
    ```

19. **Register the host in the back office.** In the console, **Admin**, **Hosts**, form
    **Register a host**:

    | Field | Value |
    |---|---|
    | name | `pve1` (must be the node's hostname; the agent's jobs address the node by it) |
    | region | `sa1` |
    | driver | `proxmox` |
    | vCPU | `8` |
    | Memory GB | `64` |
    | Disk GB | `380` |

    The numbers are a starting point; the agent's heartbeat replaces them with what the node
    reports. The page does not show the new host's id, so read it on the droplet:

    ```bash
    cd /opt/prgd && docker compose --env-file /etc/prgd/prgd.env exec -T postgres psql -U prgd prgd -c "select id, name, status from prgd_hosts"
    ```

    Note the id of `pve1` (it starts with `c`). If a host named `fake1` is listed, set it to `down`
    on the Hosts page so nothing is placed on it.

20. **Update the checkout on the droplet** so it has the WireGuard and node roles:

    ```bash
    cd /opt/progrid-src && git pull
    cd infra/ansible
    ```

21. **Inventory.** Edit `/opt/progrid-src/infra/ansible/inventory.ini` so it reads (keep any other
    variables you already had on `mgmt1`):

    ```ini
    [management]
    mgmt1 ansible_connection=local mgmt_ip=10.114.0.2 wireguard_address=10.9.0.1 wireguard_endpoint=164.90.240.114

    [pve_nodes]
    pve1 ansible_host=NODE_IP pve_node_name=pve1 host_id=THE_ID_FROM_STEP_19 wireguard_address=10.9.0.2

    [pve_nodes:vars]
    ansible_user=root
    ansible_ssh_private_key_file=/root/.ssh/progrid_pve

    [all:vars]
    ansible_python_interpreter=/usr/bin/python3
    ```

22. **Settings.** In `group_vars/all/vars.yml` keep `hypervisor_driver: fake` for now, and add or
    change these lines:

    ```yaml
    proxmox_url: https://10.9.0.2:8006   # informational: the control plane never calls Proxmox itself
    proxmox_token_id: prgd@pve!agent
    proxmox_storage: vm-disks
    proxmox_storage_type: lvmthin        # single node lab, no Ceph
    proxmox_private_bridge: customers
    proxmox_public_bridge: vmbr0
    proxmox_vxlan_zone: tenants          # only used with PRIVATE_NETWORK_MODE=sdn_vnet
    wireguard_cidr: 10.9.0.0/24
    wireguard_port: 51820
    prgd_gateway_source_addresses: 10.9.0.1/32
    ```

    Nothing new goes into the vault: the agent's Proxmox token is created on the node and its
    secret never leaves it. `vault_pve_agent_token_secret` and `vault_proxmox_token_secret` can be
    removed from the vault if they are there.

23. **Run the playbook.**

    ```bash
    ansible-playbook -i inventory.ini site.yml --ask-vault-pass
    ```

    What happens, in order: WireGuard keys are generated on the droplet and the node and `wg0`
    comes up on both; the droplet's NATS is republished on `10.9.0.1` (the stack restarts NATS and
    the services that changed); on the node, the host agent is built on the droplet in a `golang`
    container from `/opt/progrid-src` (the first build downloads the Go image and modules, a few
    minutes), copied over, and the `prgd@pve` user, `PrgdAgent` role, `agent` token, snippets on
    `local`, `/etc/prgd/agent.yaml` and the service are set up.

24. **Check the tunnel and the agent.** On the droplet:

    ```bash
    wg show                                         # peer pve1 with a recent "latest handshake"
    ping -c 3 10.9.0.2
    ss -ltn | grep 4222                             # 10.9.0.1:4222
    ```

    On the node:

    ```bash
    wg show                                         # peer mgmt1 with a recent handshake
    systemctl status host-agent --no-pager          # active (running)
    journalctl -u host-agent -n 20 --no-pager       # "agent up" with the version (git sha)
    ```

    In the console, **Admin**, **Hosts**: `pve1` shows a heartbeat less than a minute old and
    64 GB of memory.

25. **Switch the control plane to Proxmox.** In `group_vars/all/vars.yml` set
    `hypervisor_driver: proxmox` and run only the management part:

    ```bash
    ansible-playbook -i inventory.ini site.yml --limit management --ask-vault-pass
    ```

    The API and the worker restart with the Proxmox driver (`docker compose --env-file
    /etc/prgd/prgd.env logs worker | grep driver=` shows `driver=proxmox`).

## Part 6: public addresses

26. **Order the additional subnet (owner).** Robot, **Servers**, the server, **IPs**, **Order
    additional IPs / Nets**: an IPv4 **/29 subnet**. Hetzner asks for the reason (customer virtual
    servers). A subnet is routed to the main IP, needs no virtual MACs, and fits the platform: an
    IP block in the back office needs its gateway inside the block. Single additional IPs do not fit
    that model yet (each would need its own off-link gateway inside the guest); order a subnet.
    The email from Hetzner names the subnet (`SUBNET`). A /29 gives 8 addresses: the network
    address, the broadcast address and `SUBNET_GW` (the first usable) are not handed out, which
    leaves 5 for servers. Order a larger subnet when those run out.

27. **Give `vmbr0` the subnet's gateway address.** On the node, schedule the undo again
    (step 14), then in `/etc/network/interfaces` replace the `vmbr0` block with:

    ```text
    auto vmbr0
    iface vmbr0 inet static
        address SUBNET_GW/29
        bridge-ports none
        bridge-stp off
        bridge-fd 0
    ```

    ```bash
    ifreload -a
    ip -4 addr show vmbr0        # SUBNET_GW/29
    ping -c 3 1.1.1.1
    systemctl stop net-undo.timer
    ```

    From your laptop, `ping SUBNET_GW` should answer: Hetzner now routes the subnet to the node.

28. **Register the IP block.** Console, **Admin**, **IP blocks**:

    | Field | Value |
    |---|---|
    | CIDR | `SUBNET`, for example `203.0.113.8/29` (the network address) |
    | Gateway | `SUBNET_GW`, for example `203.0.113.9` |
    | Region | `sa1` |
    | RIPE | leave unticked (the addresses belong to Hetzner) |

    The block shows 5 free addresses. Set reverse DNS for them in Robot if you want names.

## Part 7: first server

29. **Credit for your own team.** Creating a billable resource needs a first top up. Console,
    **Admin**, **Teams**, your team, add credit: kind `prepaid`, amount `50`, reason `lab test`.

30. **Create a test server.** Console (as a normal user in your team), **Servers**, **Create**:
    region `sa1`, image Ubuntu 24.04, the smallest size, your SSH key. Within about two minutes it
    reaches **running** and shows a public address from `SUBNET` and a private address in
    `10.96.0.0/12`. On the node you can watch it:

    ```bash
    qm list                                  # a new VMID, name = the server name, running
    journalctl -u host-agent -f              # vm.create, vm.wait_boot, firewall jobs
    ```

31. **Check it from outside.** From your laptop:

    ```bash
    ssh root@PUBLIC_ADDRESS_OF_THE_SERVER 'ip -br addr; ip route; curl -s https://ifconfig.me; echo'
    ```

    `ip -br addr` shows the private address on the first NIC and the public one on the second,
    the default route goes via `SUBNET_GW`, and `ifconfig.me` prints the server's own public
    address.

32. **Delete it.** Console, the server, **Delete**. On the node `qm list` no longer shows it, and
    in **Admin**, **IP blocks** the address is free again. The platform works end to end.

## Rollback to the fake driver

33. If something fails and you need the site back to the previous state:

    ```bash
    cd /opt/progrid-src/infra/ansible
    sed -i 's/^hypervisor_driver:.*/hypervisor_driver: fake/' group_vars/all/vars.yml
    ansible-playbook -i inventory.ini site.yml --limit management --ask-vault-pass
    ```

    Delete any test servers first, while the Proxmox driver can still remove them. Then set `pve1`
    to `maintenance` on **Admin**, **Hosts** so nothing is placed on it, and stop its agent if you
    like (`systemctl stop host-agent` on the node). WireGuard can stay: NATS on `10.9.0.1` works for
    the fake driver too. To also undo WireGuard on the droplet, remove `wireguard_address` and
    `wireguard_endpoint` from `mgmt1` in the inventory (NATS goes back to `mgmt_ip`), run the same
    command, then `systemctl disable --now wg-quick@wg0`.

## Troubleshooting

34. **A job fails with `403 Permission check failed (..., VM.Config.X)`.** The agent's role lacks
    a privilege. Add the name to `pve_agent_privs` (in `group_vars/all/vars.yml`, copying the list
    from `roles/pve_node/defaults/main.yml`), run the playbook with `--limit pve_nodes`, and tell us
    so the default list is fixed. On Proxmox VE 9 replace `VM.Monitor` with
    `VM.GuestAgent.Audit`.

35. **The agent logs `nats: ... i/o timeout`.** The tunnel is down: `wg show` on both sides. No
    handshake means UDP 51820 is blocked; check `ufw status` on the droplet and, if the Hetzner
    Robot firewall is on for the server, allow UDP destination port 51820 there.

36. **A new agent version.** Pull the repository on the droplet and run the playbook with
    `--limit pve_nodes`. The binary is rebuilt only when the commit changes (or the agent source
    has uncommitted changes), and the agent restarts only when the binary or its config changed.
    Builds live in `/var/cache/prgd/host-agent` on the droplet and are pruned after 30 days.

37. **Per project private networks later.** `sdn_vnet` needs a VXLAN zone. Proxmox limits zone
    ids to 8 characters, so the zone cannot be called `customers`; this runbook uses `tenants`
    (`proxmox_vxlan_zone`, which becomes `PROXMOX_VXLAN_ZONE`). On a single node:
    `pvesh create /cluster/sdn/zones --type vxlan --zone tenants --peers NODE_IP --mtu 1450` and
    `pvesh set /cluster/sdn`. Read "Private networks and Proxmox SDN" in docs/hosting.md before
    switching; keep `shared_bridge` for the lab.

## Why LVM thin

- **The host agent does not need Ceph.** Disks, clones, snapshots, volumes and resizes all go
  through the Proxmox API against the storage named in `proxmox.storage`. Only two things called
  the Ceph tools: growing a detached volume (`rbd resize`) and measuring a snapshot (`rbd du`).
  The agent now has `proxmox.storage_type`: `lvmthin` grows detached volumes with `lvextend` and
  estimates snapshot sizes the way it already did when `rbd du` failed. The control plane needs no
  change: `PROXMOX_CEPH_POOL` is read but unused by the API, and every storage call goes through
  the agent. Leave it at its default.
- **LVM thin does what the platform asks of a storage:** thin provisioned disks, snapshots, full
  clones from a template and from a snapshot (create from snapshot), and raw volumes for block
  storage, at near native speed on NVMe. ZFS would need the Proxmox ISO installer through a remote
  console (installimage has no ZFS), and Proxmox cannot make a full clone from a ZFS snapshot, which
  "create from snapshot" uses. A directory with qcow2 files works too but is slower and keeps snapshots inside files.
- **Redundancy** comes from the software RAID 1 under `vg0`: one NVMe can fail without data loss.
  It is still one machine; back up to the Storage Box before customers rely on it.
- **The name stays `vm-disks`,** the agent's default, so the same settings carry over when a Ceph
  cluster arrives: create the Ceph storage under a new id, move disks, and switch
  `proxmox_storage` and `proxmox_storage_type: rbd`.

## What needs the owner

- Hetzner Robot: the rescue system and reset (step 1), the /29 subnet order (step 26), reverse DNS
  for the subnet, and, only if the Robot firewall is enabled, a rule for UDP 51820.
- Virtual MACs are not needed with this routed setup. Single additional IPs are not usable by the
  platform yet; order subnets.
- The DigitalOcean droplet firewall (if one is attached in the DigitalOcean panel) must allow UDP
  51820 inbound; ufw on the droplet is opened by the playbook.
