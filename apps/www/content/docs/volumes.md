---
title: Volumes
description: Block storage you attach to a server, grow while it runs, and keep when the server goes.
section: Guides
order: 15
---

## What a volume is

A volume is a block device on our Ceph cluster, from 10 GB to 16 TB. It lives on its own: create it, attach it to a server, detach it, attach it somewhere else, delete it when you are done. Deleting a server leaves its volumes in place, so put anything you want to keep across rebuilds on a volume rather than the server's own disk.

Volumes are charged per GB per month from the moment they exist, attached or not. The price is on the [pricing page](/pricing).

## Create and attach

From the console open **Volumes**, give it a name and a size, and pick the server to attach it to. From the CLI:

```
prgd volumes create web-data --size 100 --server web-1
```

Or through the API:

```
POST /v1/volumes
{ "name": "web-data", "sizeGb": 100, "serverId": "srv_..." }
```

The call returns at once with status `creating`. Within a few seconds the volume becomes `available`, or `attached` when you named a server. A volume attaches to one server at a time, and both must be in the same region.

## Use it in the guest

An attached volume appears in the server as a SCSI disk. Find it by its stable path under `/dev/disk/by-id`, which the API returns as `device`:

```
lsblk
sudo mkfs.ext4 /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_<serial>
sudo mkdir -p /mnt/data
sudo mount /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_<serial> /mnt/data
```

Add the same path to `/etc/fstab` with `nofail` so a detached volume does not block the next boot. The first attach needs a file system; later attaches do not.

## Grow

Volumes only grow. Resize from the console, with `prgd volumes resize ID --size 250`, or `POST /v1/volumes/{id}/resize`. An attached volume grows live; then extend the file system in the guest:

```
sudo resize2fs /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_<serial>   # ext4
sudo xfs_growfs /mnt/data                                          # xfs
```

## Detach and delete

Unmount the file system in the guest first, then detach from the console, with `prgd volumes detach ID`, or `POST /v1/volumes/{id}/detach`. A volume must be detached before you delete it, and deleting destroys the data with no undo.

## Terraform, SDKs and agents

Terraform manages a volume with the `prgd_volume` resource; `size_gb` grows in place and `server_id` attaches, detaches or moves it. The TypeScript and Python SDKs expose `volumes.create`, `attach`, `detach`, `resize`, `delete` and a `waitUntilSettled` helper. Agent tokens need the `volumes:read` and `volumes:write` scopes; the MCP server exposes `list_volumes`, `create_volume` and `volume_action`.

## Limits

| Limit | Value |
| --- | --- |
| Size | 10 GB to 16 TB |
| Volumes per server | 8 |
| Attached to | one server at a time, same region |
| Resize | grow only, live while attached |
