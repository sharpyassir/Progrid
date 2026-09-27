---
title: App Platform
description: Push code, get a URL. Containers on shared hosts, sized per instance, no server to manage.
section: Start here
order: 4
---

The App Platform takes a repository and gives you a running app at `https://<name>.apps.progrid.sa` with TLS, on hosts we run. Git Deploy does the same on a server of your own; the App Platform is for when you would rather not think about the server at all.

## What your repository needs

- A `Dockerfile` at the root is used as is. Your app must listen on the port you set (default 3000); the platform passes it as `PORT` too.
- Without one, the build detects the project: Node (`package.json`, `npm start`), Python (`requirements.txt` or `pyproject.toml`, gunicorn for `app.py` or `python main.py`), Go (`go.mod`, a static binary) or a static site (`index.html`, served by nginx).
- Compose files are not supported on shared hosts. Use Git Deploy for multi container projects.

## Create an app

Pick a name, which becomes the hostname, and a repository. From the console, **App Platform, New app**; from the terminal:

```sh
pgcloud app create hello https://github.com/you/hello --port 8080 --size app-s --instances 2 --env DATABASE_URL=... --wait
pgcloud app logs <id> --follow
```

From the API, `POST /v1/app-platform/apps` with `name` and either `repoUrl` (plus `gitToken` for a private repository) or `installationId` and `repo` from the GitHub App. Apps created through the GitHub App deploy again on every push to the branch; the others deploy with **Deploy now**, `pgcloud app deploy ID`, or `POST /v1/app-platform/apps/{id}/deploy`.

The app shows `creating` while a host is chosen, `building` while the image is built, then `live`. A failed build leaves the app `failed` with the reason in the build log; fix the repository and deploy again.

## Sizes and instances

| Size | Memory | CPU | Per instance per month |
|---|---|---|---|
| app-xs | 512 MB | 0.5 | 19 SAR |
| app-s | 1 GB | 1 | 45 SAR |
| app-m | 2 GB | 2 | 90 SAR |
| app-l | 4 GB | 4 | 180 SAR |

Run up to five instances of an app; requests are spread across them and a deploy starts the new instances beside the old ones before retiring the old ones. Billing is by the hour per instance while the app is live. **Stop** ends the charge and keeps the app; **Start** brings it back.

## Configuration

Environment variables, the branch, the port, the size, the instance count and the health path can be changed from the app page, with `pgcloud app env ID KEY=value` and `pgcloud app scale ID 3`, or with `PATCH /v1/app-platform/apps/{id}`. Every change builds and deploys again. Variables are stored on the platform and passed to the containers; they never appear in logs.

The health path (default `/`) is checked on new instances before they take traffic and every ten seconds after that.

## Custom domains

Add a domain on the app page or with `pgcloud app domains ID add app.example.com`. The domain is served only after it is verified, which proves it is yours: either point a CNAME from the domain at the app hostname, or add a TXT record at `_progrid-verify.<domain>` holding the token the app shows for that domain (`domains[].verification` in the API). The platform checks every five minutes for a week, or right away with `POST /v1/app-platform/apps/{id}/domains/{domain}/verify`. The certificate is issued on the first request after that. A domain can be attached to one app at a time.

## Logs

The build log shows the clone, the image build and the instance start. The runtime log holds every instance's output, the last 300 lines of each under its own heading. Both are on the app page, `pgcloud app logs ID [--runtime] [--follow]`, and `GET /v1/app-platform/apps/{id}/logs?type=build|runtime`.

## Limits

One region per app. Five instances, five custom domains. Instances have no persistent disk: write to a managed database or object storage. Outbound traffic is not metered. The platform keeps hosts patched and moves apps off a host that fails.
