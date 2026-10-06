# Cryptography policy

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 8.24, 5.17, 8.13 |
| NCA | ECC Defense domain (cryptography); DCC |
| Checklist | Controls 55-59, 116 |

Key procedures (generation, storage, rotation, revocation, destruction, the key inventory and
the reseal script) are in [key-management.md](key-management.md). This document sets the rules.

## 1. Purpose

Protect confidentiality and integrity of information with cryptography that is current, correctly
used and whose keys are controlled.

## 2. Scope

All cryptography Progrid operates: TLS, tunnels, encryption of data at rest, hashing of passwords
and tokens, signatures (sessions, webhooks, SSH certificates, provenance), and backup encryption.
Encryption that customers apply inside their own servers is the customer's responsibility.

## 3. Policy statements

1. **Approved algorithms.** Only these shall be used for new work:

   | Use | Approved |
   |---|---|
   | Transport | TLS 1.2 or 1.3 with forward-secret AEAD suites (Caddy defaults); WireGuard |
   | Symmetric encryption at rest | AES-256-GCM (`common/crypto/secretbox.ts`), age (X25519 + ChaCha20-Poly1305) for backups |
   | Key derivation | HKDF-SHA-256 for sub-keys from a master key |
   | Password hashing | argon2id |
   | Token storage | SHA-256 of high-entropy random tokens (≥ 32 bytes) |
   | Signatures and MACs | HMAC-SHA-256, Ed25519, ECDSA P-256; HS256 JWT with a ≥ 32-byte secret |
   | SSH | Ed25519 keys and OpenSSH certificates |
   | Randomness | The operating system CSPRNG (`crypto.randomBytes`, `crypto/rand`); never `Math.random` for secrets |

   MD5, SHA-1, DES/3DES, RC4, RSA below 2048 bits, TLS below 1.2 and unauthenticated encryption
   modes are not allowed.
2. **In transit.** All public traffic shall be TLS (Caddy with automatic certificates, HSTS).
   Traffic between the management host and Proxmox nodes shall go through WireGuard. Traffic
   that today is unencrypted on private networks (platform agents on port 9009, NATS inside
   WireGuard, Docker-internal service traffic) is recorded as a gap (risk R-11) and shall move to
   TLS or a tunnel.
3. **At rest.**
   - Secrets the platform stores for customers and for itself (TOTP seeds, webhook secrets, git
     tokens, app environment variables, database passwords, S3 secret keys, Kubernetes tokens,
     Connect credentials, SSH CA keys) shall be sealed with AES-256-GCM under a key from the
     keyring, never stored in plaintext.
   - Backups shall be encrypted with age to a recipient whose private identity is kept off the
     host, before they leave the host.
   - Full disk encryption of the management host volumes and the Proxmox storage is **not in
     place today**; it is planned (LUKS on new Proxmox nodes, encrypted volumes on the control
     plane host in phase 1). Until then the risk is covered by provider physical controls and
     the decommissioning procedure (physical-and-shared-responsibility.md §4).
   - Customers can encrypt their own volumes and databases inside their servers.
4. **Keys separate from data.** Encryption keys shall not be stored in the same database or
   backup as the data they protect. `SECRETS_KEY` is required in production and is separate from
   `JWT_SECRET`; the age private identity is never on the management host.
5. **Key management.** Every key shall have an owner, a key id, a purpose, a location and a
   rotation period in the key inventory ([key-management.md](key-management.md)). Rotation at
   least yearly for master keys, on suspicion of compromise at once, and when a person with
   access leaves.
6. **KMS.** A managed KMS or HSM (Vault Transit/OpenBao, or a cloud KMS) shall be evaluated for
   the master keys in phase 3; until then keys live in the Ansible vault and the production
   settings file with file mode 0600.
7. **Certificates.** Public certificates come from Let's Encrypt through Caddy; a CAA record for
   `letsencrypt.org` shall be set on both domains. SSH user certificates come from step-ca with a
   maximum validity of eight hours.
8. **Legal.** Use of cryptography shall respect export control and local laws (see
   `pages/*/export-sanctions.md`); legal review is needed before offering customer-managed keys
   in Saudi Arabia.

## 4. Roles

Security owner: owns this policy and the key inventory. Engineering lead: correct use in code
(reviewed in pull requests). Operations lead: TLS, WireGuard, backup encryption, host keys.

## 5. Evidence produced

Key inventory with rotation dates, rotation records (reseal runs), TLS scan results (for example
an SSL Labs or testssl.sh report per hostname, quarterly), backup encryption configuration,
code review records for crypto changes.

## 6. Review cycle

Yearly, and when an algorithm is deprecated.

## 7. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 8.24, 5.17, 8.13, 5.14 |
| NCA ECC | Defense: cryptography; data and information protection |
| NCA DCC | Data protection: encryption in transit and at rest |
| Checklist | 55, 56, 57, 58, 59, 116 |
