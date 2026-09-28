# Social sign in: Google and Microsoft

Customers can sign up and sign in to the console with a Google account or a Microsoft account
(work, school or personal), next to email and password. This page is for the people who run
Progrid: how to register the two apps, where the credentials go, and how the flow works.

A provider's button shows in the console only when both its client id and its client secret are
set. Leaving them empty hides it; nothing else changes.

## Redirect URIs to register

| Provider  | Redirect URI                                              |
|-----------|-----------------------------------------------------------|
| Google    | `https://api.progrid.sa/v1/auth/oauth/google/callback`    |
| Microsoft | `https://api.progrid.sa/v1/auth/oauth/microsoft/callback` |

They are built from `OAUTH_REDIRECT_BASE` (default `PUBLIC_API_URL`). For local development also
register `http://localhost:4000/v1/auth/oauth/google/callback` and
`http://localhost:4000/v1/auth/oauth/microsoft/callback` on separate development apps, not on the
production ones.

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/), open the project picker and
   choose **New project**. Name it `Progrid`, pick the organization if there is one, and choose
   **Create**. Make sure the new project is selected.
2. Go to **APIs & Services, OAuth consent screen** (in the newer layout this is **Google Auth
   Platform**) and choose **Get started**.
   * **App name**: `Progrid`
   * **User support email**: `support@progrid.sa`
   * **Audience**: **External**
   * **Contact information**: an engineering address that reads mail, for example `hostmaster@progrid.sa`
   * Accept the user data policy and choose **Create**.
3. Under **Branding**:
   * **Application home page**: `https://progrid.sa`
   * **Privacy policy**: `https://progrid.sa/legal/privacy`
   * **Terms of service**: `https://progrid.sa/legal/terms`
   * **Authorized domains**: add `progrid.sa`
   * The logo is optional. Uploading one requires Google's brand verification before it shows.
4. Under **Data Access**, choose **Add or remove scopes** and select `openid`,
   `.../auth/userinfo.email` and `.../auth/userinfo.profile` (shown as openid, email and profile).
   These are non sensitive scopes, so no security assessment is needed. **Save**.
5. Under **Clients**, choose **Create client**:
   * **Application type**: **Web application**
   * **Name**: `Progrid API`
   * **Authorized JavaScript origins**: leave empty (the code exchange happens on the server)
   * **Authorized redirect URIs**: `https://api.progrid.sa/v1/auth/oauth/google/callback`
   * Choose **Create**, then copy the **Client ID** and the **Client secret** right away (download
     the JSON as well; the secret is not shown again).
6. Under **Audience**, choose **Publish app** and confirm, so the status is **In production**.
   While the app is in **Testing**, only the listed test users can sign in and their consent
   expires after seven days.
7. Put the values in the configuration (see [Configuration](#configuration)):
   `GOOGLE_CLIENT_ID` and, through the vault, `vault_google_client_secret`.

Google client secrets do not expire, but rotate one if it may have leaked: under **Clients**,
open the client, **Add secret**, deploy the new value, then disable and delete the old one.

## Microsoft (Entra ID)

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) with an account that may
   register applications, and go to **Identity, Applications, App registrations**. Choose
   **New registration**.
   * **Name**: `Progrid`
   * **Supported account types**: **Accounts in any organizational directory (Any Microsoft
     Entra ID tenant, Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**
   * **Redirect URI**: platform **Web**, `https://api.progrid.sa/v1/auth/oauth/microsoft/callback`
   * Choose **Register**.
2. On the **Overview** page copy the **Application (client) ID**. That is `MICROSOFT_CLIENT_ID`.
   Keep `MICROSOFT_TENANT=common` so work, school and personal accounts can all sign in
   (`organizations` allows only work and school accounts, `consumers` only personal ones, and a
   directory id allows only that directory).
3. Under **Certificates & secrets, Client secrets**, choose **New client secret**. Describe it
   with the date (for example `prgd api 2026-10`) and pick an expiry (**24 months** is the longest
   offered). Copy the **Value** column, not the Secret ID, into `vault_microsoft_client_secret`.
   **Put a reminder in the operations calendar one month before the expiry date.** When a secret
   expires, every Microsoft sign in fails with `invalid_client` until a new one is deployed. To
   rotate: create a second secret, deploy it, check that a Microsoft sign in works, then delete
   the old secret.
4. Under **API permissions**, choose **Add a permission, Microsoft Graph, Delegated permissions**
   and add `openid`, `email` and `profile`. `User.Read` may already be listed; it is not needed and
   can be removed. These permissions need no admin consent.
5. Under **Token configuration**, choose **Add optional claim, ID**, and select `email` and
   `xms_edov`. Accept the prompt to turn on the Microsoft Graph email permission. `xms_edov` tells
   us that the directory has verified the domain of the email address; without it a work or school
   account is never linked automatically to an existing Progrid account with the same email.
6. Under **Authentication**, leave the implicit grant boxes (access tokens, ID tokens) unticked
   and **Allow public client flows** off. The API uses the authorization code flow with a secret
   and PKCE.
7. Optional but recommended, under **Branding & properties**: home page `https://progrid.sa`,
   terms `https://progrid.sa/legal/terms`, privacy `https://progrid.sa/legal/privacy`, a logo,
   and **Publisher domain** `progrid.sa` (verified by serving the file Microsoft offers at
   `https://progrid.sa/.well-known/microsoft-identity-association.json`).
8. Optional: **publisher verification**. With a Microsoft AI Cloud Partner Program (MPN) id linked
   under **Branding & properties, Publisher verification**, the consent screen shows Progrid as a
   verified publisher. Without it the screen says the app is unverified, and some organizations
   block their users from consenting to unverified multitenant apps.

## Configuration

| Key                       | Where                         | Notes |
|---------------------------|-------------------------------|-------|
| `GOOGLE_CLIENT_ID`        | `google_client_id` in vars    | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET`    | `vault_google_client_secret`  | secret |
| `MICROSOFT_CLIENT_ID`     | `microsoft_client_id` in vars | Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | `vault_microsoft_client_secret` | secret, expires |
| `MICROSOFT_TENANT`        | `microsoft_tenant` in vars    | default `common` |
| `OAUTH_REDIRECT_BASE`     | set by the Ansible template   | default `PUBLIC_API_URL`, `https://api.progrid.sa` in production |

With Ansible, put the ids in `group_vars/all/vars.yml` and the secrets in
`group_vars/all/vault.yml`, then run the management playbook so `prgd.env` is rewritten and the
API restarts. Without Ansible, edit `/etc/prgd/prgd.env` (see `infra/prod/prgd.env.example`) and
restart the API. Check with:

```sh
curl -s https://api.progrid.sa/v1/auth/providers
# {"providers":[{"id":"google","name":"Google"},{"id":"microsoft","name":"Microsoft"}]}
```

## How it works

1. The console links to `GET /v1/auth/oauth/{provider}/start?intent=login|signup|link`. The API
   creates `state`, `nonce` and a PKCE verifier, stores them in Redis for 10 minutes keyed by
   `state`, sets an HttpOnly, Secure, SameSite=Lax cookie holding a random value (its hash is
   stored with the state), and redirects to the provider with scopes `openid email profile`.
2. The provider sends the browser to `/v1/auth/oauth/{provider}/callback`. The API takes the state
   out of Redis (single use), compares the cookie, exchanges the code with the PKCE verifier and
   the client secret, and verifies the id token: signature against the provider's published keys
   (cached, refetched on key rotation), audience, expiry, nonce and issuer. Google's issuer is
   `https://accounts.google.com`. Microsoft's `common` discovery document publishes the issuer as
   `https://login.microsoftonline.com/{tenantid}/v2.0`; the API fills in the token's `tid` and the
   token's `iss` must match exactly.
3. The API decides whose account it is (below) and redirects to the console
   `/auth/callback?code=…`. The code is random, single use and valid for 60 seconds. Session tokens
   never appear in a URL.
4. The console posts the code to `POST /v1/auth/oauth/exchange` and gets the same answer as a
   password login. Accounts with two factor sign in get `{totpRequired, ticket}` and finish with
   `POST /v1/auth/oauth/totp`. Staff accounts without two factor sign in are refused.

Linking from **Security** cannot carry the console session through a browser redirect, so the
console first asks for a one time ticket (`POST /v1/auth/oauth/link-ticket`, 60 seconds) and
passes it to `/start?intent=link&ticket=…`.

### Whose account is it

1. The provider account (provider and `sub`) is already linked: that user signs in.
2. Not linked, and a user has the same email: link automatically only when the provider vouches
   for the address.
   * Google: `email_verified` is true.
   * Microsoft: the `email` claim is present, and either the account is a personal Microsoft
     account (`tid` `9188040d-6c67-4c5b-b112-36a304b66dad`) or the token has `xms_edov` true.
   * Otherwise nothing is linked. The person is told to sign in with the password and link the
     account under **Security**. This stops anyone who can put an arbitrary address in a work
     directory from taking over the Progrid account with that address.
   For accounts with two factor sign in the link is written only after the second factor.
3. Nobody has the address: a user is created (email confirmed when the provider vouches for it,
   otherwise the usual confirmation mail goes out) with a new team named after the person,
   country SA, currency SAR, exactly as the signup form does, and the person lands on the
   welcome view of **Security**. The prepaid rules apply as usual. With an invitation link the
   person joins the inviting team instead, and only when the provider's address is the invited
   one.

When the owner of an unconfirmed address later proves it (a password reset link, or Google or
Microsoft vouching for it), every identity that was linked with that address without the
provider vouching for it is removed. That closes account pre hijacking: someone who created an
account with another person's address through a directory that does not verify addresses loses
access the moment the real owner shows up.

A social only account has no password. Password sign in tells such a person which button to
use, and **Forgot password** lets them set one. An account can unlink a provider only while it
keeps another way to sign in: a password or another linked account.

Every sign in, link, unlink, refused link and social sign up is written to the audit log
(`user.signed_in`, `user.identity_linked`, `user.identity_unlinked`, `user.oauth_refused`,
`user.oauth_signup`).

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Google shows `redirect_uri_mismatch` | The redirect URI in the client does not match `OAUTH_REDIRECT_BASE` exactly (scheme, host, no trailing slash). |
| Microsoft shows `AADSTS50011` | Same, for the app registration's Web redirect URI. |
| Microsoft shows `AADSTS700016` | Wrong `MICROSOFT_CLIENT_ID`, or the app was registered for a single tenant. |
| Console says the answer could not be verified (`token_invalid`) | The API log line `sign in refused` has the reason: expired secret (`invalid_client`), clock skew over a minute, or a tenant outside `MICROSOFT_TENANT`. |
| Console says the sign in took too long (`state_invalid`) | More than 10 minutes passed, the flow was started in another browser, or cookies are blocked for the API domain. |
| A work account is not linked to the existing user | Expected without `xms_edov`: sign in with the password and link under **Security**. Check that `xms_edov` is added under **Token configuration**. |
