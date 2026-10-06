# Secure development lifecycle

| | |
|---|---|
| Document owner | [Engineering lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 8.25, 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.33, 8.4, 5.8 |
| NCA | ECC Governance domain (cybersecurity in IT projects); ECC Defense domain (web application security) |
| Checklist | Controls 38-44, 46, 52, 53, 64, 65, 79-88 |

## 1. Purpose

Build security into every change to the platform, so that what reaches production has been
designed, reviewed and tested for security.

## 2. Scope

All code and configuration in this repository: `apps/*`, `agents/*`, `services/*`, `packages/*`,
`infra/*`, `.github/*`, and code written by contractors or AI coding assistants. Customer
code deployed through the App Platform is covered by the threat model, not by this lifecycle.

## 3. Lifecycle stages

| Stage | Required |
|---|---|
| Plan | For a new product, a new trust boundary, a new supplier or a change to auth, crypto, tenancy or the deploy path: update [threat-model.md](threat-model.md) and, if a trigger in risk-methodology.md §6 applies, the risk register. Security requirements are written in the issue or design doc |
| Build | Secure coding rules (§4); secrets never in code; dependencies only from the official registries with lockfiles |
| Review | Pull request with review (§5); security checklist for sensitive paths |
| Test | Unit tests, the integration suite (`pnpm test:integration`) including tenant isolation tests, automated security gates (§6) |
| Release | Deploy only from `main` after CI and security gates pass; images scanned and attested (§7) |
| Operate | Vulnerability management, logging, incident response; findings feed back as issues |

## 4. Secure coding rules

1. Every API route is authenticated by the global guard unless explicitly public, and declares
   its scope or staff area. Object access checks the caller's team and project (no lookups by
   id alone).
2. Input is validated with DTOs (`ValidationPipe` with whitelist and `forbidNonWhitelisted`);
   environment configuration is validated with zod (`apps/api/src/config/config.ts`).
3. Database access goes through Prisma; raw SQL uses tagged templates with parameters only.
4. Anything that runs a shell command quotes every input (lesson from the App Platform build
   agent injection, `docs/readiness-review.md` item 22).
5. Outbound requests built from customer input go through the network guard
   (`apps/api/src/common/net`), which blocks private, link-local and metadata addresses.
6. Errors returned to clients carry a code and a message, never stack traces or internal details;
   Swagger is off in production.
7. Secrets are read from configuration, sealed at rest with `common/crypto/secretbox.ts`,
   compared in constant time, and redacted from logs.
8. Browser apps set a Content Security Policy and do not render untrusted HTML without
   sanitising it.
9. Passwords and secrets use the approved algorithms of
   [cryptography-policy.md](cryptography-policy.md); `Math.random` is never used for secrets.
10. AI coding assistants may be used; their output is reviewed like any other code and they are
    never given production secrets.

## 5. Code review and branch protection

1. Every change to `main` shall go through a pull request. Direct pushes to `main` shall be
   blocked.
2. `.github/CODEOWNERS` assigns the owner to every path; security-sensitive paths
   (`.github/`, `infra/`, `agents/`, `apps/api/src/common/auth/`, `apps/api/src/common/crypto/`,
   `apps/api/prisma/`, `docs/security/`) always need the code owner's review.
3. While only one person has write access, self-review is unavoidable: the weekly change review
   ([change-management.md](change-management.md)) re-reads every merged change to the sensitive
   paths and records the result. A second reviewer shall be added as soon as a second engineer
   joins.

**Settings the repository owner must enable** (GitHub, Settings, Branches and Rules; evidence: a
screenshot or `gh api repos/{owner}/{repo}/branches/main/protection` export filed under
`evidence/11-devsecops/`):

| Setting | Value |
|---|---|
| Branch protection / ruleset on `main` | Enabled, applies to administrators |
| Require a pull request before merging | On; required approvals 1 (once a second reviewer exists) |
| Require review from Code Owners | On |
| Dismiss stale approvals on new commits | On |
| Require status checks to pass | `ci` jobs (typecheck, unit, integration, Go, Python) and `security` jobs (codeql, gitleaks, dependencies, dependency-review, iac) |
| Require branches to be up to date | On |
| Require conversation resolution | On |
| Require signed commits | Recommended |
| Block force pushes and deletions | On |
| Restrict who can push to `main` | Owner only |
| GitHub secret scanning and push protection | On |
| Dependabot alerts and security updates | On |
| Code scanning (CodeQL default or the workflow) | On |
| Actions: allow only selected actions (GitHub, verified creators, listed ones) | On |
| Actions: fork pull request workflows need approval; read-only `GITHUB_TOKEN` by default | On |
| Environment `production` with required reviewers | On (used by the deploy job) |

## 6. Automated security gates

Defined in `.github/workflows/security.yml`, `ci.yml` and `deploy.yml` (feat/security-iso).

| Gate | Tool | When | Blocking |
|---|---|---|---|
| Static analysis (SAST) | CodeQL for JavaScript/TypeScript, Go and Python | Every PR, push to `main`, weekly | High/Critical alerts must be triaged before merge |
| Secret scanning | gitleaks (`.gitleaks.toml`) | Every PR and push | Yes |
| Dependency review | `actions/dependency-review-action` | Every PR | Yes, for new High/Critical vulnerable dependencies |
| Dependency audit | `pnpm audit`, `govulncheck` | Every PR, push, weekly | Yes for Critical |
| Dependency updates | Dependabot (`.github/dependabot.yml`) | Weekly | — |
| Infrastructure as code | Trivy config scan of the repository | Every PR, push, weekly | High/Critical findings triaged; exceptions in `.trivyignore` with owner and expiry |
| Container images | Trivy image scan of each built image | Before push in `deploy.yml` | Yes for Critical |
| Provenance and SBOM | `actions/attest-build-provenance`, SBOM | On every image build | — |
| Tests | Unit and integration suites, tenant isolation tests | Every PR and push | Yes |

A gate may be bypassed only through an exception under
[vulnerability-and-patch-management.md](vulnerability-and-patch-management.md) §7.

## 7. Build and deploy

1. Images are built only by GitHub Actions from `main` or a `v*` tag, scanned, attested and
   pushed to `ghcr.io/sharpyassir`.
2. The deploy job runs after CI passes, never for pull requests from forks, with minimal job
   permissions; the SSH key is used only by a step that runs no third-party action; the host key
   is pinned; the image tag is validated; the server-side `deploy` user has a forced command that
   can only run `/opt/prgd/deploy.sh <tag>`.
3. Migrations are forward only; a migration that drops or rewrites data is a high-risk change
   ([change-management.md](change-management.md)).

## 8. Contractors and outsourced development

Contractors who write code follow this lifecycle, work in branches of the Progrid repository (not
private forks), sign the confidentiality terms of people-security.md §3, and get no production
secrets.

## 9. Environments and test data

Development (local, fake drivers), CI (ephemeral Postgres, Redis, Temporal) and production are
separate. There is no staging environment yet (checklist 85, planned). Production customer data
is never used in development or CI (data-classification-and-handling.md §5).

## 10. Roles

Engineering lead owns this lifecycle and triages gate findings; the Security owner reviews
changes to sensitive paths and approves exceptions; every developer follows the rules.

## 11. Evidence produced

Pull requests with reviews, CI and security workflow runs, CodeQL and Dependabot alerts with
their resolution, branch protection export, deploy records with image digests and attestations,
threat model updates.

## 12. Review cycle

Yearly, and when the toolchain changes.

## 13. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.8, 8.4, 8.25, 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.32, 8.33 |
| NCA ECC | Governance: cybersecurity in IT projects; Defense: web application security, vulnerabilities management |
| Checklist | 38-44, 46, 52, 53, 64, 65, 79-88 |
