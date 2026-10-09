---
title: App Platform
description: Push code, get a URL. Containers on shared hosts, sized per instance, no server to manage.
section: Start here
order: 4
---

The App Platform takes a repository and gives you a running app at `https://<name>.<apps domain>` (the console shows the exact address) with TLS, on hosts we run. Git Deploy does the same on a server of your own; the App Platform is for when you would rather not think about the server at all.

## What your repository needs

- A `Dockerfile` at the root is used as is. Your app must listen on the port you set (default 3000); the platform passes it as `PORT` too.
- Without one, the build detects the project: Node (`package.json`, `npm start`), Python (`requirements.txt` or `pyproject.toml`, gunicorn for `app.py` or `python main.py`), Go (`go.mod`, a static binary) or a static site (`index.html`, served by nginx).
- Compose files are not supported on shared hosts. Use Git Deploy for multi container projects.

## Create an app

Pick a name, which becomes the hostname, and a repository. From the console, **App Platform, New app**; from the terminal:

```sh
prgd app create hello https://github.com/you/hello --port 8080 --size app-s --instances 2 --env DATABASE_URL=... --wait
prgd app logs <id> --follow
```

From the API, `POST /v1/app-platform/apps` with `name` and either `repoUrl` (plus `gitToken` for a private repository) or `installationId` and `repo` from the GitHub App. Apps created through the GitHub App deploy again on every push to the branch; the others deploy with **Deploy now**, `prgd app deploy ID`, or `POST /v1/app-platform/apps/{id}/deploy`.

The app shows `creating` while a host is chosen, `building` while the image is built, then `live`. A failed first build leaves the app `failed` with the reason in the build log; fix the repository and deploy again. When a later deploy fails, the version that was running keeps serving: the app stays `live` and its status message says what failed.

New to the platform with a Node app and a database? Follow [Deploy a Node.js app with Prisma and Postgres](/docs/prisma-postgres).

## Sizes and instances

| Size | Memory | CPU | Per instance per month |
|---|---|---|---|
| app-xs | 512 MB | 0.5 | $5.07 |
| app-s | 1 GB | 1 | $12.00 |
| app-m | 2 GB | 2 | $24.00 |
| app-l | 4 GB | 4 | $48.00 |

Run up to five instances of an app; requests are spread across them and a deploy starts the new instances beside the old ones before retiring the old ones. Billing is by the hour per instance while the app is live. **Stop** ends the charge and keeps the app; **Start** brings it back.

## Configuration

Environment variables, the branch, the port, the size, the instance count, the health path and the pre-deploy command can be changed from the app page, with `prgd app env ID KEY=value` and `prgd app scale ID 3`, or with `PATCH /v1/app-platform/apps/{id}`. Every change builds and deploys again. Variables are stored on the platform and passed to the containers; they never appear in logs.

The health path (default `/`) is checked on new instances before they take traffic and every ten seconds after that.

## Pre-deploy command

A command that runs once per deploy, after the image is built and before the new version replaces the running one: database migrations are the usual case.

```sh
npx prisma migrate deploy
```

Set it under **Configuration, Pre-deploy command**, with `preDeployCommand` on `POST` or `PATCH /v1/app-platform/apps/{id}` (an empty string removes it), and it applies from the next deploy. It runs with `sh -c` in a container from the new image, with the app's environment variables, attached databases, network and size limits, for at most ten minutes. Its output goes into the build log between `=== pre-deploy: <command> ===` and `=== pre-deploy exited <code> ===`. If it exits with anything but 0, or runs out of time, the deploy fails with `pre-deploy command failed (exit N)` and the version already running is not touched.

Write migrations so that the running version keeps working while they run and after (add a column before the code that needs it, drop it a deploy later): the old instances serve traffic until the new ones are healthy.

## Console

Run one off commands, like seeding a database or checking migrations, in a fresh container from the app's live image. The container has the app's environment variables, attached databases, network and limits, but no terminal: it is not interactive (no TTY, stdin is closed). On the app page, **Console** takes a command and a timeout (one minute to an hour, ten minutes by default) and shows the output as it comes, every two seconds, with **Cancel** while it runs. From the terminal:

```sh
prgd app run <app id> -- npx prisma db seed
```

prints the output and exits with the command's exit code. From the API, `POST /v1/app-platform/apps/{id}/runs` with `command` and an optional `timeoutSeconds` (30 to 3600), then `GET /v1/app-platform/apps/{id}/runs/{runId}` until `status` is `succeeded`, `failed`, `timed_out` or `canceled`; `POST .../runs/{runId}/cancel` stops it.

- An app runs at most two commands at a time (`409 run_limit` beyond that).
- Commands need a live image: an app whose first deploy has not succeeded yet cannot run one. A stopped app can, so you can migrate before starting it again.
- The output kept is the last 64 KB, with credentials in URLs and values of variables named like secrets (`*_TOKEN`, `*_SECRET`, `*PASSWORD*`, `*_KEY`, `DATABASE_URL`) masked. The history keeps the last 50 runs.
- Every command is recorded in the audit log (`app.run_started` with the command, `app.run_finished`, `app.run_canceled`). Readonly members see runs but cannot start them. An AI agent token gets `approval_required`: a team owner or admin approves the command under **Approvals** before it runs.

## Attach a database

Attach a [managed database](/docs/databases) of the same project in one step: under **Database** on the app page, choose the database and the variable (default `DATABASE_URL`), or `POST /v1/app-platform/apps/{id}/databases` with `databaseId` and optionally `envName` and `database`. The platform then:

1. creates a user and a database named after the app (`app_<name>`, hyphens become underscores) on the cluster; on PostgreSQL the user owns the database, so migrations can create tables. Name an existing database with `database` to use it instead. Valkey has no named databases: the app gets its own ACL user;
2. adds the public address of the app's host to the database's trusted sources (as a `/32`, listed under `appSources`), and moves it when the app moves to another host. A database without trusted sources is open to anywhere already and stays that way; the user's password and TLS are still required;
3. deploys the app again with the connection URL in the variable: `postgresql://user:password@host:5432/db?sslmode=require`, `mysql://...?ssl-mode=REQUIRED`, or `rediss://user:password@host:6380` for Valkey. The URL is built when the app is deployed and is not stored with your variables, so it does not show in the app's environment variables. **Show connection URL** (`GET .../databases/{linkId}/credentials`, recorded in the audit log) shows it.

The databases use a self signed certificate: the connection is encrypted, but clients must not insist on verifying the certificate (Prisma does not by default; for Prisma on MySQL add `&sslaccept=accept_invalid_certs`).

A variable can hold one database. Attaching to a variable the app already sets returns `409 env_conflict`; so does setting that variable by hand while the database is attached.

**Detach** (`DELETE .../databases/{linkId}`) deploys the app without the variable, disables the app's database user and removes the host's address from the trusted sources; addresses you added yourself stay. The database and its data stay on the cluster; delete it from the database page when you no longer need it. Deleting the app detaches its databases the same way. A database with apps attached cannot be deleted (`409 database_in_use`): detach it first.

## Custom domains

Add a domain on the app page or with `prgd app domains ID add app.example.com`. The domain is served only after it is verified, which proves it is yours: either point a CNAME from the domain at the app hostname, or add a TXT record at `_progrid-verify.<domain>` holding the token the app shows for that domain (`domains[].verification` in the API). The platform checks every five minutes for a week, or right away with `POST /v1/app-platform/apps/{id}/domains/{domain}/verify`. The certificate is issued on the first request after that. A domain can be attached to one app at a time.

## Logs

The build log shows the clone, the image build and the instance start. The runtime log holds every instance's output, the last 300 lines of each under its own heading. Both are on the app page, `prgd app logs ID [--runtime] [--follow]`, and `GET /v1/app-platform/apps/{id}/logs?type=build|runtime`.

## Limits

One region per app. Five instances, five custom domains, two console commands at a time. Instances have no persistent disk: write to a managed database or object storage. Outbound traffic is not metered. The platform keeps hosts patched and moves apps off a host that fails.
