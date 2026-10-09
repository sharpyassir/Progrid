---
title: Deploy a Node.js app with Prisma and Postgres
description: A Node app on the App Platform with a managed PostgreSQL database, migrations on every deploy and a seed from the console.
section: Start here
order: 5
---

This guide takes a Node.js app that uses [Prisma](https://www.prisma.io) from a GitHub repository to a running app with its own PostgreSQL database. Migrations run on every deploy, before the new version takes traffic, and the database is seeded once from the console. It takes about ten minutes.

## What you need

- A Progrid account with a payment method (see [Getting started](/docs/getting-started)).
- A Node.js repository that uses Prisma with `provider = "postgresql"` and reads the connection from `env("DATABASE_URL")`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- Migrations committed to the repository under `prisma/migrations` (made with `npx prisma migrate dev` on your machine).
- `prisma` itself in `dependencies`, not only `devDependencies`, so `npx prisma` works in the image. Generate the client during the build: a `postinstall` or `build` script with `prisma generate`.
- An app that listens on the `PORT` variable (the platform sets it; default 3000).

A `package.json` that does all of this:

```json
{
  "scripts": {
    "build": "prisma generate",
    "start": "node server.js"
  },
  "prisma": { "seed": "node prisma/seed.js" },
  "dependencies": { "@prisma/client": "^6.0.0", "prisma": "^6.0.0" }
}
```

Without a `Dockerfile` the platform builds the project on Node 20 with `npm ci` (or `npm install`), runs `npm run build` when there is one, and starts it with `npm start`.

## 1. Create the database

In the console, **Databases, Create database**: PostgreSQL, the smallest size is fine to start with, and in the same project and region you will use for the app. Or from the terminal:

```sh
prgd databases create shop-db --engine postgres --size s-1vcpu-2gb --wait
```

Wait until it is **active**. If you set trusted sources, keep them: the next steps add the app's host to them. If you leave them empty, the database accepts connections from anywhere, still only with a password over TLS.

## 2. Create the app

**App Platform, New app**, with your repository and the port your app listens on. Set the **Pre-deploy command** under **Configuration** once the app exists, or from the API when you create it:

```sh
curl -X POST https://api.progrid.co/v1/app-platform/apps \
  -H "Authorization: Bearer $PRGD_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"shop","repoUrl":"https://github.com/you/shop","port":3000,"preDeployCommand":"npx prisma migrate deploy"}'
```

The first deploy runs `npx prisma migrate deploy` before the app starts. Without a database yet it fails to connect, and that is expected: the next step fixes it. You can also attach the database first and set the pre-deploy command afterwards.

## 3. Attach the database

On the app page, under **Database**, choose `shop-db`, keep the variable `DATABASE_URL` and select **Attach**. The platform creates a user and a database called `app_shop` on the cluster (the user owns the database, so Prisma can create tables), lets the app's host through the database's trusted sources, and deploys the app again with:

```
DATABASE_URL=postgresql://app_shop:<password>@<database address>:5432/app_shop?sslmode=require
```

This time the pre-deploy step applies your migrations, and the build log shows them:

```
=== pre-deploy: npx prisma migrate deploy ===
3 migrations found in prisma/migrations
Applying migration `20261001000000_init`
All migrations have been successfully applied.
=== pre-deploy exited 0 ===
```

If a migration fails, the deploy fails and the version that was already running keeps serving; read the build log, fix the migration and deploy again.

## 4. Seed the database

Open **Console** on the app page and run `npx prisma db seed` (it is one of the suggestions under the command box). The command runs once, in a fresh container from the live image with the app's variables, and its output shows as it comes. From the terminal:

```sh
prgd app run <app id> -- npx prisma db seed
```

The CLI prints the output and exits with the command's exit code, so it fits in a script. `npx prisma migrate status` is a quick check that the database matches the repository.

## 5. Day to day

- Every push (with the GitHub App) or **Deploy now** builds, migrates, then swaps the instances. Keep migrations compatible with the version still running while they apply.
- **Show connection URL** under **Database** gives you the URL to connect from your machine, for example with `npx prisma studio`; add your own address to the database's trusted sources first if it has any.
- Need more than one database, or a cache? Attach another one with a different variable, such as `CACHE_URL` for a Valkey database.

## Troubleshooting

- `P1001: Can't reach database server`: the database is not active yet, or its trusted sources do not include the app's host. Attach the database from the app page rather than copying the URL by hand, so the host is added for you.
- `permission denied for schema public`: the app connects as a user that does not own the database (for example the cluster's `app` user with `defaultdb`). Use the URL from **Attach**.
- `sh: prisma: not found` in the pre-deploy step: `prisma` is only in `devDependencies`. Move it to `dependencies`.
- A command that waits for input hangs until its timeout: console commands have no terminal. Pass flags instead, such as `npx prisma migrate reset --force`.
