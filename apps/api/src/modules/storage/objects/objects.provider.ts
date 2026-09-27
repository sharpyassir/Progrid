import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { presignUrl, signHeaders } from './sigv4';

/**
 * Object storage backend. The control plane owns one RGW user per project; buckets and keys
 * hang off it. Object access by customers goes straight to the S3 endpoint with their keys;
 * the API only lists, deletes and presigns on their behalf (console and CLI convenience).
 */
export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: string;
  etag?: string;
}

export interface ObjectStorageProvider {
  readonly name: string;
  /** Idempotent: the project's RGW user. */
  ensureUser(projectId: string): Promise<void>;
  createKey(projectId: string): Promise<{ accessKey: string; secretKey: string }>;
  deleteKey(projectId: string, accessKey: string): Promise<void>;
  createBucket(projectId: string, name: string): Promise<void>;
  deleteBucket(projectId: string, name: string): Promise<void>;
  setPublic(projectId: string, name: string, isPublic: boolean): Promise<void>;
  listObjects(projectId: string, name: string, prefix: string, continuationToken?: string): Promise<{ objects: ObjectInfo[]; prefixes: string[]; nextToken?: string }>;
  deleteObject(projectId: string, name: string, key: string): Promise<void>;
  presign(projectId: string, name: string, key: string, method: 'GET' | 'PUT' | 'DELETE', expiresSeconds: number, contentType?: string): Promise<string>;
  usage(projectId: string, name: string): Promise<{ sizeBytes: bigint; objectCount: number }>;
  /** True when the bucket still has objects (delete is refused). */
  isEmpty(projectId: string, name: string): Promise<boolean>;
}

export const OBJECT_STORAGE_PROVIDER = Symbol('OBJECT_STORAGE_PROVIDER');

/** Deletes every object in a bucket, then the bucket. Returns how many objects went. */
export async function emptyAndDeleteBucket(storage: ObjectStorageProvider, projectId: string, bucket: string): Promise<number> {
  let removed = 0;
  const walk = async (prefix: string): Promise<void> => {
    let token: string | undefined;
    do {
      const page = await storage.listObjects(projectId, bucket, prefix, token);
      for (const o of page.objects) {
        await storage.deleteObject(projectId, bucket, o.key);
        removed++;
      }
      for (const p of page.prefixes) await walk(p);
      token = page.nextToken;
    } while (token);
  };
  await walk('');
  await storage.deleteBucket(projectId, bucket);
  return removed;
}

/** In memory S3 for development. Objects are served by FakeS3Controller at /_fake-s3. */
export class FakeObjectStorage implements ObjectStorageProvider {
  readonly name = 'fake';
  readonly buckets = new Map<string, { owner: string; public: boolean; objects: Map<string, { body: Buffer; contentType: string; lastModified: Date }> }>();
  private readonly keys = new Map<string, { projectId: string; secretKey: string }>();
  constructor(private readonly endpoint: string, private readonly signingSecret: string) {}

  async ensureUser() {}
  async createKey(projectId: string) {
    const accessKey = 'PGC' + randomBytes(8).toString('hex').toUpperCase();
    const secretKey = randomBytes(24).toString('base64url');
    this.keys.set(accessKey, { projectId, secretKey });
    return { accessKey, secretKey };
  }
  async deleteKey(_p: string, accessKey: string) {
    this.keys.delete(accessKey);
  }
  async createBucket(projectId: string, name: string) {
    if (!this.buckets.has(name)) this.buckets.set(name, { owner: projectId, public: false, objects: new Map() });
  }
  async deleteBucket(_p: string, name: string) {
    this.buckets.delete(name);
  }
  async setPublic(_p: string, name: string, isPublic: boolean) {
    const b = this.buckets.get(name);
    if (b) b.public = isPublic;
  }
  async listObjects(_p: string, name: string, prefix: string) {
    const b = this.buckets.get(name);
    const objects: ObjectInfo[] = [];
    const prefixes = new Set<string>();
    for (const [key, o] of b?.objects ?? []) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) prefixes.add(prefix + rest.slice(0, slash + 1));
      else objects.push({ key, size: o.body.length, lastModified: o.lastModified.toISOString() });
    }
    return { objects: objects.sort((a, b) => a.key.localeCompare(b.key)), prefixes: [...prefixes].sort() };
  }
  async deleteObject(_p: string, name: string, key: string) {
    this.buckets.get(name)?.objects.delete(key);
  }
  async presign(_p: string, name: string, key: string, method: 'GET' | 'PUT' | 'DELETE', expiresSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + expiresSeconds;
    const sig = this.sign(method, name, key, exp);
    return `${this.endpoint}/${name}/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&method=${method}&sig=${sig}`;
  }
  async usage(_p: string, name: string) {
    const b = this.buckets.get(name);
    let size = 0n;
    for (const o of b?.objects.values() ?? []) size += BigInt(o.body.length);
    return { sizeBytes: size, objectCount: b?.objects.size ?? 0 };
  }
  async isEmpty(_p: string, name: string) {
    return (this.buckets.get(name)?.objects.size ?? 0) === 0;
  }

  sign(method: string, bucket: string, key: string, exp: number) {
    return createHmac('sha256', this.signingSecret).update(`${method}\n${bucket}\n${key}\n${exp}`).digest('hex');
  }
  verify(method: string, bucket: string, key: string, exp: number, sig: string) {
    if (exp < Date.now() / 1000) return false;
    const want = Buffer.from(this.sign(method, bucket, key, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}

/**
 * Ceph RADOS Gateway. Users and keys through the Admin Ops API (signed with the admin
 * user's S3 keys); buckets and objects through the S3 API signed with the same admin keys
 * but attributed to the project user by creating the bucket via `uid`-owned link.
 */
export class RgwObjectStorage implements ObjectStorageProvider {
  readonly name = 'rgw';
  constructor(private readonly adminUrl: string, private readonly s3Url: string, private readonly region: string, private readonly accessKey: string, private readonly secretKey: string) {}

  private get creds() {
    return { accessKey: this.accessKey, secretKey: this.secretKey, region: this.region };
  }
  private async admin<T = unknown>(method: string, path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.adminUrl.replace(/\/$/, '')}/admin/${path}`);
    for (const [k, v] of Object.entries({ ...params, format: 'json' })) url.searchParams.set(k, v);
    const r = await fetch(url, { method, headers: signHeaders(this.creds, method, url), signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`RGW admin ${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as T) : (null as T);
  }
  private async s3(method: string, bucket: string, key = '', query: Record<string, string> = {}, body?: Buffer | string, headers: Record<string, string> = {}) {
    const url = new URL(`${this.s3Url.replace(/\/$/, '')}/${bucket}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const r = await fetch(url, { method, headers: signHeaders(this.creds, method, url, headers, body ?? ''), body, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok && r.status !== 404) throw new Error(`S3 ${method} ${bucket}/${key}: ${r.status} ${text.slice(0, 300)}`);
    return { status: r.status, text };
  }
  private uid(projectId: string) {
    return `proj-${projectId}`;
  }

  async ensureUser(projectId: string) {
    const uid = this.uid(projectId);
    try {
      await this.admin('GET', 'user', { uid });
    } catch {
      await this.admin('PUT', 'user', { uid, 'display-name': `pgcloud project ${projectId}`, 'generate-key': 'false' });
    }
  }
  async createKey(projectId: string) {
    const r = await this.admin<{ keys: { access_key: string; secret_key: string }[] }>('PUT', 'user?key', { uid: this.uid(projectId), 'generate-key': 'true' });
    const k = r.keys[r.keys.length - 1];
    return { accessKey: k.access_key, secretKey: k.secret_key };
  }
  async deleteKey(projectId: string, accessKey: string) {
    await this.admin('DELETE', 'user?key', { uid: this.uid(projectId), 'access-key': accessKey });
  }
  async createBucket(projectId: string, name: string) {
    await this.s3('PUT', name);
    // Hand ownership to the project user so their keys (and quotas, usage) apply.
    await this.admin('PUT', 'bucket', { bucket: name, uid: this.uid(projectId) });
  }
  async deleteBucket(_p: string, name: string) {
    await this.admin('DELETE', 'bucket', { bucket: name, 'purge-objects': 'false' });
  }
  async setPublic(_p: string, name: string, isPublic: boolean) {
    if (isPublic) {
      const policy = JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${name}/*`] }] });
      await this.s3('PUT', name, '', { policy: '' }, policy, { 'content-type': 'application/json' });
    } else {
      await this.s3('DELETE', name, '', { policy: '' });
    }
  }
  async listObjects(_p: string, name: string, prefix: string, continuationToken?: string) {
    const q: Record<string, string> = { 'list-type': '2', prefix, delimiter: '/', 'max-keys': '1000' };
    if (continuationToken) q['continuation-token'] = continuationToken;
    const { text } = await this.s3('GET', name, '', q);
    const objects: ObjectInfo[] = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
      key: xml(m[1], 'Key'), size: Number(xml(m[1], 'Size')), lastModified: xml(m[1], 'LastModified'), etag: xml(m[1], 'ETag').replace(/&quot;|"/g, ''),
    }));
    const prefixes = [...text.matchAll(/<CommonPrefixes><Prefix>(.*?)<\/Prefix><\/CommonPrefixes>/g)].map((m) => decode(m[1]));
    const next = text.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1];
    return { objects, prefixes, nextToken: next ? decode(next) : undefined };
  }
  async deleteObject(_p: string, name: string, key: string) {
    await this.s3('DELETE', name, key);
  }
  async presign(_p: string, name: string, key: string, method: 'GET' | 'PUT' | 'DELETE', expiresSeconds: number) {
    const url = new URL(`${this.s3Url.replace(/\/$/, '')}/${name}/${key.split('/').map(encodeURIComponent).join('/')}`);
    return presignUrl(this.creds, method, url, expiresSeconds);
  }
  async usage(_p: string, name: string) {
    const r = await this.admin<{ usage?: { 'rgw.main'?: { size_actual?: number; num_objects?: number } } }>('GET', 'bucket', { bucket: name, stats: 'true' });
    const m = r?.usage?.['rgw.main'];
    return { sizeBytes: BigInt(m?.size_actual ?? 0), objectCount: m?.num_objects ?? 0 };
  }
  async isEmpty(p: string, name: string) {
    return (await this.usage(p, name)).objectCount === 0;
  }
}

function xml(s: string, tag: string) {
  return decode(s.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1] ?? '');
}
function decode(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
