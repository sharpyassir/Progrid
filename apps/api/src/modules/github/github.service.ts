import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import type { Actor } from '../../common/auth/actor';

export interface GithubRepo { id: number; fullName: string; private: boolean; defaultBranch: string; htmlUrl: string; pushedAt: string | null }

/**
 * GitHub App: the customer installs our app on their account or organization; we then mint
 * short lived installation tokens to clone private repositories and receive one app level
 * webhook for every push. No personal access tokens change hands.
 *
 * Auth flow (docs.github.com/apps): app JWT (RS256, our private key) → installation access token.
 */
@Injectable()
export class GithubService {
  private readonly log = new Logger(GithubService.name);
  private readonly tokenCache = new Map<number, { token: string; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    const c = loadConfig();
    return !!(c.GITHUB_APP_ID && c.GITHUB_APP_PRIVATE_KEY && c.GITHUB_APP_SLUG);
  }

  /** Where the console sends a user to install the app. `state` ties the callback to the team. */
  connectUrl(actor: Actor) {
    this.mustBeEnabled();
    const state = this.signState(actor.teamId);
    return { url: `https://github.com/apps/${loadConfig().GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`, state };
  }

  /** Callback from the console after GitHub redirected back with installation_id and state. */
  async connect(actor: Actor, installationId: number, state: string) {
    this.mustBeEnabled();
    if (!this.verifyState(actor.teamId, state)) throw ApiError.unauthorized('The connect link is invalid or expired. Start again from the console.');
    const info = await this.appFetch<{ account: { login: string; type: string } }>(`/app/installations/${installationId}`);
    const row = await this.prisma.githubInstallation.upsert({
      where: { installationId },
      create: { installationId, teamId: actor.teamId, accountLogin: info.account.login, accountType: info.account.type },
      update: { teamId: actor.teamId, accountLogin: info.account.login, accountType: info.account.type, suspendedAt: null },
    });
    return row;
  }

  list(actor: Actor) {
    return this.prisma.githubInstallation.findMany({ where: { teamId: actor.teamId }, orderBy: { createdAt: 'asc' } });
  }

  async remove(actor: Actor, id: string) {
    const row = await this.prisma.githubInstallation.findFirst({ where: { id, teamId: actor.teamId } });
    if (!row) throw ApiError.notFound('github_installation', id);
    await this.prisma.githubInstallation.delete({ where: { id } });
    // Best effort: also uninstall on the GitHub side so the customer does not keep a dangling app.
    await this.appFetch(`/app/installations/${row.installationId}`, { method: 'DELETE' }).catch(() => undefined);
  }

  /** Repositories the installation can reach, newest push first. */
  async repos(actor: Actor, id: string): Promise<GithubRepo[]> {
    const inst = await this.prisma.githubInstallation.findFirst({ where: { id, teamId: actor.teamId } });
    if (!inst) throw ApiError.notFound('github_installation', id);
    const token = await this.installationToken(inst.installationId);
    const out: GithubRepo[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.ghFetch<{ repositories: any[] }>(`/installation/repositories?per_page=100&page=${page}`, token);
      out.push(...r.repositories.map((x) => ({ id: x.id, fullName: x.full_name, private: x.private, defaultBranch: x.default_branch, htmlUrl: x.html_url, pushedAt: x.pushed_at })));
      if (r.repositories.length < 100) break;
    }
    return out.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
  }

  /** Short lived token (one hour) for cloning; cached until a minute before expiry. */
  async installationToken(installationId: number): Promise<string> {
    const hit = this.tokenCache.get(installationId);
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const r = await this.appFetch<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: 'POST' });
    this.tokenCache.set(installationId, { token: r.token, expiresAt: new Date(r.expires_at).getTime() });
    return r.token;
  }

  /** Verifies the app level webhook (X-Hub-Signature-256 with the app's webhook secret). */
  verifyWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = loadConfig().GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) throw ApiError.unauthorized('GitHub App webhook secret is not configured');
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw ApiError.unauthorized('Invalid webhook signature');
    }
  }

  /** Installation removed or suspended from the GitHub side. */
  async handleInstallationEvent(action: string, installationId: number) {
    if (action === 'deleted') await this.prisma.githubInstallation.deleteMany({ where: { installationId } });
    else if (action === 'suspend') await this.prisma.githubInstallation.updateMany({ where: { installationId }, data: { suspendedAt: new Date() } });
    else if (action === 'unsuspend') await this.prisma.githubInstallation.updateMany({ where: { installationId }, data: { suspendedAt: null } });
  }

  // ---- helpers ----

  private mustBeEnabled() {
    if (!this.enabled) throw new ApiError(503, 'github_app_unavailable', 'GitHub App integration is not configured on this installation. Use a repository URL with a token instead.');
  }

  private signState(teamId: string) {
    const ts = Date.now().toString(36);
    const mac = createHmac('sha256', loadConfig().JWT_SECRET).update(`${teamId}.${ts}`).digest('base64url');
    return `${teamId}.${ts}.${mac}`;
  }

  private verifyState(teamId: string, state: string) {
    const [tid, ts, mac] = state.split('.');
    if (tid !== teamId || !ts || !mac) return false;
    if (Date.now() - parseInt(ts, 36) > 30 * 60_000) return false;
    const expected = createHmac('sha256', loadConfig().JWT_SECRET).update(`${teamId}.${ts}`).digest('base64url');
    return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  }

  private async appJwt() {
    const c = loadConfig();
    const key = await importPKCS8(c.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'RS256');
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuedAt(now - 30).setExpirationTime(now + 9 * 60).setIssuer(String(c.GITHUB_APP_ID)).sign(key);
  }

  private async appFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.ghFetch<T>(path, await this.appJwt(), init);
  }

  private async ghFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'prgd', ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.log.warn(`github ${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      throw new ApiError(502, 'github_error', `GitHub answered ${res.status}: ${(body as { message?: string }).message ?? 'unknown error'}`);
    }
    return body as T;
  }
}
