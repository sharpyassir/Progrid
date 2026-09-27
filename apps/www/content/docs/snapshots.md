---
title: Snapshots and backups
description: Copy a whole disk on demand, or let us do it every day.
section: Guides
order: 14
---

## Snapshots

A snapshot is a copy of the whole disk at that moment. Take one from the server's **Snapshots** tab, with `pgcloud servers snapshot web-1`, or with the `snapshot` action in the API. Snapshots are charged per GB per month.

A snapshot taken while the server runs can miss data that was only in memory. For a database, stop the server first or use the database's own dump tool alongside.

## Restoring a server

Roll a server back to one of its own snapshots with `pgcloud servers restore web-1 SNAPSHOT_ID`, the `restore_server` MCP tool, or `POST /v1/servers/{id}/restore` and `{"snapshotId": "..."}`. The server powers off, its disk returns to the moment of the snapshot, and it powers on again with the same address. Everything written since the snapshot is lost, including on volumes that were attached when it was taken.

## New server from a snapshot

Create a copy of a server by passing `snapshotId` instead of `image` to `POST /v1/servers`, or with `pgcloud servers create web-2 --snapshot SNAPSHOT_ID`. The copy runs in the same region, gets a fresh address, your SSH keys and its own hostname, and needs a size with at least as much disk as the original. The server the snapshot was taken from must still exist.

## Backups

Turn on backups when you create a server, or later from its page, with `pgcloud servers backups ID on`, or `PATCH /v1/servers/{id}` with `backups: true`. We take a snapshot every night at 02:10 UTC and keep the last seven; they show in the snapshot list marked as daily backups and can be used like any snapshot. Backups cost 20 percent of the server price, and the backup snapshots themselves are not charged as snapshot storage.

## Retention

Snapshots stay until you delete them. Backups roll over after seven days. Deleting a server keeps its snapshots and stops its backups.
