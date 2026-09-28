---
title: Account security
description: Sign in with Google or Microsoft, two factor sign in, recovery codes, password reset, email confirmation and what agents can and cannot do.
section: Guides
order: 12
---

## Sign in with Google or Microsoft

On the sign in page, choose **Continue with Google** or **Continue with Microsoft** to sign up or sign in without a password. Microsoft sign in works with work, school and personal accounts. A new account gets its own team, the same as signing up with email, and the email address is confirmed when Google or Microsoft has confirmed it.

If you already have a Progrid account with the same email address, it is linked automatically when Google or Microsoft confirms that the address is yours. When they cannot confirm it (some work and school directories), sign in with your password and link the account under **Security, Sign in methods**.

Under **Security, Sign in methods** you can link and unlink Google and Microsoft accounts and see whether a password is set. You always keep at least one way to sign in, so the last one cannot be unlinked. An account without a password can get one with **Forgot password** on the sign in page. Two factor sign in still applies: after Google or Microsoft, Progrid asks for your authenticator code.

## Two factor sign in

Under **Security, Two Factor Sign In**, choose **Set up**, scan the code with Google Authenticator, 1Password, Authy or any app that does standard time based codes, and confirm with a six digit code. You then get ten recovery codes, shown once. Each recovery code signs you in a single time if you lose your device.

Team owners must have two factor sign in on. Until it is on, an owner's session can reach only the account and security pages.

To turn it off or move to a new device, enter a current code under **Security** and choose **Turn off**, then set it up again.

## Password reset

Choose **Forgot password** on the sign in page. The link in the email lasts one hour. Using it makes every other reset link for the account useless.

## Email confirmation

Your address must be confirmed before the team can create servers. If the first email did not arrive, **Security** has a button to send it again.

## API tokens

Tokens are shown once and stored hashed. Revoke one under **Managed Agents, Agent Access** and it stops working at once. Tokens cannot have scopes their creator does not have, and agent tokens cannot create other tokens.

## Sessions and limits

Console sessions last 24 hours. Sign in is limited to 10 attempts per minute per address. Every API call, by people and by agents, is written to the audit log under **Security, Audit Log** with who, what and when.

## What an agent can never do

Decide an approval, create tokens, spend past its cap, or reach a project its token was not scoped to. Those checks run in the API, not in the agent, so they hold whatever the agent is told.
