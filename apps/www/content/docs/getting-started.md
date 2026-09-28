---
title: Getting started
description: Create an account and launch your first server in about a minute.
section: Start here
order: 1
---

Progrid is a developer cloud built for Saudi Arabia. You get servers by the hour, one click apps, and API tokens that AI agents can use safely. Everything you can do in the console you can also do from the command line, the API, or an AI agent.

## 1. Create an account

Open the [console](https://console.progrid.sa/login), choose **Create account**, and enter your name, a team name, your email, and a password of ten characters or more. New accounts start with credit so you can try things before adding a card.

You can also choose **Continue with Google** or **Continue with Microsoft** and skip the password. See [Account security](/docs/security) for how linking works.

Confirm your email from the message we send. Servers cannot be created until the team owner has a confirmed address.

## 2. Add an SSH key

Under **Security, SSH Keys**, paste your public key. Every server you create gets the keys on your account, so you can log in as `root` right away.

```sh
cat ~/.ssh/id_ed25519.pub
```

If you do not have a key yet:

```sh
ssh-keygen -t ed25519 -C "you@example.com"
```

## 3. Create a server

Go to **Core Cloud, Servers** and choose **Create server**. Pick a size, an image such as Ubuntu 24.04 or a one click app, give it a name, and confirm. The price is shown before you create it, in dollars or riyals.

The server appears with status `new`, then `provisioning`, then `active`. It takes about a minute. Click the server name to open its page, where the connect command is ready to copy:

```sh
ssh root@203.0.113.3
```

## 4. Turn on two factor sign in

Under **Security, Two Factor Sign In**, scan the code with any authenticator app and confirm. Save the recovery codes somewhere safe. Team owners are required to turn this on.

## What next

- [Use the command line](/docs/cli) to create and manage servers from your terminal.
- [Deploy from GitHub](/docs/git-deploy) so a push to your branch deploys your app.
- [Give an AI agent access](/docs/agents) with a spending cap and approval rules.
- [Understand billing](/docs/billing): hourly, capped at the monthly price, in USD or SAR.
