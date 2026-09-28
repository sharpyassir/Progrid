---
title: Deploy from GitHub
description: Connect a repository once. Every push to the branch deploys your app on its own server.
section: Start here
order: 3
---

Git Deploy takes a repository, creates a server, installs Docker, builds your app and keeps it running. After that, a webhook from GitHub redeploys on every push to the branch you chose.

## What your repository needs

One of these, at the root:

- a `Dockerfile`: the app is built and run from it, listening on the port you set (default 3000)
- a `docker-compose.yml` or `compose.yaml`: brought up as is
- neither: a Node, Python or Go project is detected and a matching Dockerfile is generated

Environment variables you enter are written to the server and passed to the container. Secrets never leave the server.

## Connect GitHub once

Go to **Projects, Deploys** and choose **Connect GitHub**. GitHub asks which account or organization to install the Progrid app on and which repositories it may see. You can change that list any time from GitHub. After that, every deploy is a matter of picking a repository from a list: private repositories work without any token, and every push to the chosen branch redeploys without touching repository settings.

If you would rather not install the app, switch to **Repository URL** and paste the address. Private repositories then need a token with read access, which is stored on the server only.

## From the console

Pick the repository or paste the URL, choose the branch, set the port and any variables, and confirm.

The deploy shows `creating`, then `deploying`, then `live` with the public address. Choose **Logs** on any deployment to watch the build log, refreshed from the server every few seconds. A failed build shows the error right there.

## From the command line

```sh
prgd deploy https://github.com/you/app --branch main --port 8080 --env DATABASE_URL=...
prgd deploys ls
prgd deploys logs dep_123 --follow
prgd deploys redeploy dep_123
```

## Automatic redeploys

Deployments made through the GitHub App redeploy on every push to their branch. Nothing to configure.

Deployments made from a URL get their own webhook address and secret, shown once when they are created. Add it to the repository under **Settings, Webhooks** with content type `application/json` and the push event. Pushes to other branches are ignored. Every delivery is checked with the `X-Hub-Signature-256` header before anything runs.

If you would rather not touch repository settings, the CLI step in your CI works just as well: `prgd deploys redeploy ID` after your tests pass.

## Redeploy and roll back

**Redeploy** pulls the branch, rebuilds and restarts. To roll back, redeploy from a tag or an earlier commit by changing the branch on the deploy page. The server keeps its address through all of this.
