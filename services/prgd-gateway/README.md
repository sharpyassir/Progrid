# prgd-gateway

The terminal gateway of the DevOps console. The ops app (`ops.progrid.co`, also served at `ops.progrid.sa`) opens a WebSocket to
it; the gateway checks the one time token with the API, gets a short lived OpenSSH certificate for
a key it generated in memory, logs in to the asset over SSH, and pipes the terminal both ways. It
records every session as asciicast v2, types stored sudo passwords without showing them, and ends
the session at grant expiry or on a kill. The API side of the contract is in
`docs/devops-console.md`, "Gateway contract".

```sh
pnpm --filter @prgd/gateway build && node services/prgd-gateway/dist/main.js
pnpm --filter @prgd/gateway test          # vitest
```

## WebSocket protocol

`GET /v1/terminal?session=<sessionId>` upgrades to a WebSocket. The `Origin` header must be one of
`PRGD_GATEWAY_ALLOWED_ORIGINS` (else `403`), `session` must look like an id (else `400`), and a
gateway at `PRGD_GATEWAY_MAX_SESSIONS` answers `503`. Every frame is a JSON text frame (at most
1 MiB); a binary or malformed frame before auth closes the socket, and one after auth is ignored.

### Client to gateway

| Frame | Meaning |
|---|---|
| `{"type":"auth","token":"prgd_gws_...","cols":120,"rows":32}` | Must be the first frame, within 5 seconds of the upgrade. `cols` and `rows` (1 to 1000, default 80 by 24) size the pty. |
| `{"type":"input","data":"ls -la\r"}` | Keystrokes and pastes. `data` is a UTF-8 string, exactly what xterm.js `onData` gives. For raw bytes (xterm.js `onBinary`) add `"encoding":"base64"` and send base64. |
| `{"type":"resize","cols":132,"rows":43}` | New terminal size. |
| `{"type":"ping"}` | Answered with `{"type":"pong"}` (an application level check; the gateway also sends WebSocket ping frames). |

Frames of other types are ignored. Input before `ready` is dropped.

### Gateway to client

| Frame | Meaning |
|---|---|
| `{"type":"ready","sessionId","expiresAt","banner","policy":{"clipboardPaste":true,"fileDownload":false},"asset":{"id","name"},"ticket":{"id","number"},"recorded":true}` | The shell is open. Show `banner`; count down to `expiresAt` (ISO 8601). |
| `{"type":"output","data":"<base64>"}` | Terminal output. `data` is **always base64** of the raw bytes; pass the decoded `Uint8Array` to `term.write` (xterm.js keeps UTF-8 sequences split across frames intact). |
| `{"type":"notice","message","expiresAt"?}` | Something to show outside the terminal: 5 minutes and 1 minute before the grant ends (with `expiresAt`), an extension (new `expiresAt`), the gateway answering sudo, stored credentials being unavailable. |
| `{"type":"pong"}` | Answer to `ping`. |
| `{"type":"closed","reason","message"?}` | The last frame; the gateway closes the socket right after. |

`closed.reason` and the WebSocket close code:

| reason | Close code | When |
|---|---|---|
| `auth_timeout`, `auth_required`, `bad_frame` | 4001 | No auth frame in time, or the first frame was something else |
| `token_invalid` | 4001 | The API does not know the token (or it names another session) |
| `token_used`, `token_expired`, `grant_inactive`, `grant_expired`, `session_killed`, `residency_blocked`, `engineer_inactive`, `forbidden`, `asset_unavailable` | 4003 | session-check refused (the API's code, passed through) |
| `api_unavailable` | 1011 | The API could not be reached |
| `grant_expired` | 1000 | The grant ended during the session |
| `killed` | 1000 | A kill on NATS or an event answer with `action: "kill"`; `message` is the reason |
| `ssh_closed` | 1000 | The shell exited or the asset closed the connection |
| `error` | 1011 | SSH login failed, a host key problem (`message` says `host_key_mismatch`, `host_key_unknown` or `host_key_revoked`), the API was unreachable for 3 heartbeats in a row, or the gateway is shutting down |

Closing the socket from the browser ends the session (`client_closed`). The gateway sends a
WebSocket ping every 25 seconds and drops a client that missed the previous one.

There is no other channel: no file transfer, no port forwarding, no agent forwarding, no X11, no
exec and no SFTP. The gateway only ever asks the asset for a pty and a shell, and refuses any
channel the asset tries to open towards it. Clipboard paste works because a paste is input.

## What happens in a session

1. The auth frame arrives. The gateway generates an ed25519 key pair (a node `KeyObject`, never
   exported or written anywhere) and calls `POST /internal/gateway/session-check` with the token,
   the session id from the URL, the OpenSSH public key, `PRGD_GATEWAY_ID` and the client address
   (the first `X-Forwarded-For` entry from Caddy).
2. It reads the secret refs session-check lists (`POST /internal/gateway/secrets`), keeping the
   values in memory for this session only.
3. It connects to `target` with the certificate (below), checks the host key, opens a pty and a
   shell, sends `ready` and the `started` event (with the host key), then a `heartbeat` event every
   `kill.heartbeatSeconds` (30) with byte totals.
4. On the end: `closed` to the browser, SSH closed, an `error` event first when it failed, the
   `ended` event with the reason, then the recording upload and `recording_stored`.

Events go out one at a time in order. Every answer is obeyed: `action: "kill"` ends the session,
and a new `expiresAt` (an extension) moves the expiry timers. If three heartbeats in a row cannot
reach the API the session is ended (fail closed).

### Certificates with ssh2

ssh2 1.x has no API for OpenSSH user certificates, and its public key authentication writes the
key algorithm name as the signature format name. For `ssh-ed25519-cert-v01@openssh.com` OpenSSH
requires the signature blob to say `ssh-ed25519`, so `src/ssh-client.ts` writes that one
`USERAUTH_REQUEST` itself (two ssh2 internals are used: the key parser and `sendPacket`; the
version is pinned by the lockfile). `test/openssh.test.ts` logs in to a real `sshd` configured
like a production asset (`TrustedUserCAKeys`, `AuthorizedPrincipalsFile`) to prove it; it runs when
sshd is installed and the tests run as root.

### Host keys

With `PRGD_GATEWAY_KNOWN_HOSTS` set, the host must be listed in that OpenSSH known_hosts file with
the key it presents (plain, `[host]:port`, wildcard, negated and hashed entries, and `@revoked`
lines are understood; `@cert-authority` lines are ignored because ssh2 cannot verify host
certificates). Without it the gateway trusts the first key an asset presents and pins it in memory,
per asset id and per address, until the process restarts; a different key later refuses the
session. Either way the key is sent to the API on `started` (`hostKey`, `hostKeyFingerprint`) and
lands in the audit log.

Production should not rely on trust on first use: generate a known_hosts file from the assets'
host keys (collected at provisioning) and set `PRGD_GATEWAY_KNOWN_HOSTS`; `SIGHUP` rereads it
without dropping sessions. Host certificates signed by step-ca would be better still, but need an SSH
library that verifies them.

### Sudo passwords

When session-check lists a ref with a `sudo_password` key, the gateway answers a sudo prompt for
the login user itself: when the output ends with `[sudo] password for <user>:`, it writes the value
and a newline into the shell. Those keystrokes are not sent to the browser, not recorded and not
counted in `bytesIn`. Every output byte passes a redactor that replaces any secret value (4
characters or more) with `********` before the browser or the recording sees it, holding back at
most the length of the longest value for 40 ms to catch a value split across packets. If sudo
answers `Sorry, try again.` the gateway stops answering for the rest of the session so a wrong
stored value cannot lock the account.

Limitations, by design of prompt based injection:

- A program the engineer runs can print the same prompt and read what the gateway types. The
  redactor hides the plain value, not an encoded copy (base64, hex). Treat the stored sudo password
  as exposed to anyone with a grant on the asset: give the login user a password used only for this,
  rotate it after sessions (offboarding already opens a rotate secrets task), and prefer
  `NOPASSWD` sudo rules for specific commands where the customer allows it.
- Only sudo's default prompt is recognized; a custom `Defaults passprompt` or a localized prompt is
  not answered and the engineer is asked as usual.
- Only `sudo_password` is typed. Other keys under the ref are only used for redaction.

### Recordings

The recorder writes asciicast v2 to a file under `PRGD_GATEWAY_SPOOL_DIR` (default the system
temporary directory), in a private directory with mode 0600: a header line
`{"version":2,"width","height","timestamp","env":{"TERM","SHELL"},"title"}`, then
`[seconds, "o", text]` for output (after redaction) and `[seconds, "r", "COLSxROWS"]` for resizes
(asciinema-player understands both). Input is never recorded. After the session the file is PUT to
`recording.uploadUrl` with `Content-Type: application/x-asciicast` and an explicit
`Content-Length`; when the URL has expired, or storage refuses it, the gateway asks
`POST /internal/gateway/recording-url` for a new one and retries (4 attempts with backoff). Then it
sends `recording_stored` with the key and the size and deletes the file. If every attempt fails it
sends an `error` event and keeps the file in the spool directory for an operator to upload by hand.

## Kills

Three paths end a live session: a message on NATS subject `prgd.gateway.sessions.kill`
(`{"sessionId","grantId","gatewayId","reason","at"}`; ids the gateway does not hold are ignored),
an event answer with `action: "kill"`, and the grant expiry timer. The NATS connection reconnects
forever; while it is down the heartbeat answer still ends a killed session within 30 seconds.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `PRGD_API_URL` | `http://api:4000` | Internal API base (never the public proxy) |
| `PRGD_GATEWAY_SECRET` | empty | Sent as `X-Prgd-Gateway-Secret`; must equal the API's |
| `PRGD_GATEWAY_PORT` | 4100 | HTTP and WebSocket port |
| `PRGD_GATEWAY_ID` | the hostname | Reported in session-check and events |
| `NATS_URL`, `NATS_TOKEN` | empty | Kill subscription; without `NATS_URL` only event answers kill |
| `PRGD_GATEWAY_KNOWN_HOSTS` | empty | known_hosts file to enforce; empty means trust on first use |
| `PRGD_GATEWAY_MAX_SESSIONS` | 50 | Open connections at once (including ones still authenticating) |
| `PRGD_GATEWAY_ALLOWED_ORIGINS` | `https://ops.progrid.co,https://ops.progrid.sa` | Comma separated exact origins allowed to connect |
| `PRGD_GATEWAY_SPOOL_DIR` | system temp directory | Where recordings are written while sessions run |
| `PRGD_GATEWAY_TRUST_PROXY` | `true` | Take the client address from `X-Forwarded-For` |
| `PRGD_GATEWAY_AUTH_TIMEOUT_SECONDS` | 5 | Time allowed for the auth frame |
| `PRGD_GATEWAY_KEEPALIVE_SECONDS` | 25 | WebSocket ping interval |
| `PRGD_GATEWAY_HEARTBEAT_SECONDS` | 30 | Heartbeat interval when session-check does not give one |
| `PRGD_GATEWAY_EXPIRY_NOTICES` | `300,60` | Seconds before the grant ends at which a notice is sent |
| `PRGD_GATEWAY_SSH_TIMEOUT_SECONDS` | 15 | SSH handshake timeout |
| `PRGD_GATEWAY_LOG` | empty | `silent` turns logging off (tests) |

`GET /healthz` answers `{"ok":true,"gatewayId","sessions","maxSessions","hostKeys"}`. Logs are one
JSON object per line; tokens, keys and secret values are never logged. `SIGTERM` ends every
session (reason `error`), uploads the recordings and exits.

## Tests

`pnpm --filter @prgd/gateway test` runs everything in process: a fake API (session-check signs a
real certificate with a test CA, events, secrets, recording-url, and a presigned PUT target) and an
ssh2 SSH server that accepts only a valid certificate from that CA for the right principal, with a
small shell (`echo`, `size`, `sudo whoami`, `leak`, `exit`). They cover the full session, resize,
the asciicast file, sudo injection absent from the browser stream and the recording, redaction,
expiry with notices, extension, kills from the listener and from event answers, client disconnect,
bad and used tokens, origins, the auth timeout, host key pinning and known_hosts, and capacity.
`test/nats.test.ts` runs the kill over a real `nats-server` when one is on the PATH or named by
`NATS_SERVER_BIN`; `test/openssh.test.ts` runs against a real `sshd` as described above.
