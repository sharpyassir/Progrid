---
title: Command line
description: Install Progrid on your computer and manage everything from the terminal.
section: Start here
order: 2
---

The `prgd` command is a single binary for Linux, macOS and Windows with no dependencies.

## Install

```sh
curl -fsSL https://get.progrid.co | sh
```

On Windows, download the zip from the releases page and put `prgd.exe` on your `PATH`.

## Sign in

```sh
prgd login
```

Enter your email and password. If two factor sign in is on, you are asked for the code from your authenticator app. The session is saved in `~/.config/prgd/config.json`. You can also paste an API token instead of an email to use that token.

## Your first server

```sh
prgd servers create web-1 --size s-1vcpu-1gb --image ubuntu-24-04 --wait
prgd servers ls
prgd ssh web-1
```

`--wait` blocks until the server is active and prints its address. Every create call sends an idempotency key, so a retried command never makes two servers.

## Everyday commands

| Task | Command |
|---|---|
| List sizes with prices | `prgd sizes` |
| List images and one click apps | `prgd images` |
| Stop, start, reboot | `prgd servers stop web-1`, `start`, `reboot` |
| Resize | `prgd servers resize web-1 --size s-2vcpu-4gb` |
| Take a snapshot | `prgd servers snapshot web-1` |
| Delete | `prgd servers delete web-1` |
| Deploy a repository | `prgd deploy https://github.com/you/app --branch main` |
| Run a command in an App Platform app | `prgd app run shop -- npx prisma db seed` (exits with the command's code) |
| See spend | `prgd billing` |
| Create an agent token | `prgd tokens create claude --agent --cap 15` |
| Review agent requests | `prgd approvals ls`, `approve ID`, `deny ID --reason TEXT` |

Add `--json` to any command to get the raw API response, which is handy in scripts:

```sh
prgd servers ls --json | jq -r '.data[] | select(.status=="active") | .networks.v4[0].ipAddress'
```

## Scripting and CI

In CI, set `PRGD_TOKEN` to an API token and `PRGD_API_URL` if you use a different endpoint. The CLI reads those before the config file, so no login step is needed.

```yaml
- run: curl -fsSL https://get.progrid.co | sh
- run: prgd deploy https://github.com/${{ github.repository }} --branch ${{ github.ref_name }}
  env:
    PRGD_TOKEN: ${{ secrets.PRGD_TOKEN }}
```
