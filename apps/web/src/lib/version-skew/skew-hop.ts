/**
 * Signs the skew-protection hop (worker.ts): the current version asks an old one through its preview URL, and a
 * version answers there only for a request the current version signed. Everything else on a preview URL gets 421.
 *
 * HMAC-SHA-256 over the public host, method, path with query and the minute, with a key derived from
 * INTERNAL_API_KEY (both versions have the same binding). A signature holds for the minute it was made in, one before and one after (clocks differ a little).
 * A version that has this code is asked only by versions that have it too: a deployment's mapping names older
 * builds only. CF_WORKER_NAME is set on deployments with skew protection, so PR previews and local development are
 * not affected.
 *
 * apps/admin-web/src/lib/version-skew/skew-hop.ts is a copy: keep them in step.
 */
import { isPreviewHost, SKEW_HOST_HEADER, withPublicHost } from './skew-host';

export const SKEW_SIGNATURE_HEADER = 'x-aun-skew-signature';

export interface SkewHopEnv {
  CF_WORKER_NAME?: string;
  CF_PREVIEW_DOMAIN?: string;
  /** Build id → Worker version id, or "current" (scripts/release/skew-mapping.ts) */
  CF_DEPLOYMENT_MAPPING?: string;
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

/** Each app's own hostnames (production, stage, QA) */
const WEB_HOST = /^videos(?:\.(?:qa|stage))?\.alummahnow\.net$/;
const ADMIN_HOST = /^admin(?:\.(?:qa|stage))?\.alummahnow\.net$/;
const isOwnHost = (host: string, env: SkewHopEnv) => (env.CF_WORKER_NAME?.includes('admin') ? ADMIN_HOST : WEB_HOST).test(host);

const LABEL = 'aun skew hop v1';
const encoder = new TextEncoder();
const minuteOf = (now: number) => Math.floor(now / 60_000);

/** A settled key, never a promise: a promise of another request can't be awaited in a Worker. */
let cached: { secret: string; key: CryptoKey } | null = null;

async function hopKey(env: SkewHopEnv): Promise<CryptoKey | null> {
  const binding = env.INTERNAL_API_KEY;
  const secret = typeof binding === 'string' ? binding : await binding?.get().catch(() => '');
  if (!secret) return null;
  if (cached?.secret === secret) return cached.key;
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, encoder.encode(LABEL));
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cached = { secret, key };
  return key;
}

let mapping: { text: string; builds: Map<string, unknown> } | null = null;

/** Whether OpenNext forwards a request of this build: it is mapped to another version. Read from env, so it holds from an isolate's first request. */
function isOlderBuild(build: string, env: SkewHopEnv): boolean {
  const text = env.CF_DEPLOYMENT_MAPPING ?? '';
  if (mapping?.text !== text) {
    let builds = new Map<string, unknown>();
    try {
      builds = new Map(Object.entries(JSON.parse(text || '{}') as Record<string, unknown>));
    } catch {
      // No usable mapping: OpenNext forwards nothing either
    }
    mapping = { text, builds };
  }
  const version = mapping.builds.get(build);
  return typeof version === 'string' && version !== '' && version !== 'current';
}

const message = (host: string, method: string, url: URL, minute: number) => encoder.encode([LABEL, host, method, url.pathname + url.search, minute].join('\n'));
const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

/** An 8-hex version of this Worker on the account's preview domain. */
function isOwnVersion(hostname: string, env: SkewHopEnv): boolean {
  const version = hostname.slice(0, hostname.indexOf('-'));
  return /^[0-9a-f]{8}$/.test(version) && hostname === `${version}-${env.CF_WORKER_NAME}.${env.CF_PREVIEW_DOMAIN}.workers.dev`;
}

async function signed(request: Request, env: SkewHopEnv, now: number): Promise<boolean> {
  const url = new URL(request.url);
  const host = request.headers.get(SKEW_HOST_HEADER) ?? '';
  const signature = request.headers.get(SKEW_SIGNATURE_HEADER) ?? '';
  if (!isOwnVersion(url.hostname, env) || !isOwnHost(host, env) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const key = await hopKey(env);
  if (!key) return false;
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (h) => parseInt(h, 16));
  for (const minute of [minuteOf(now), minuteOf(now) - 1, minuteOf(now) + 1]) {
    if (await crypto.subtle.verify('HMAC', key, bytes, message(host, request.method, url, minute))) return true;
  }
  return false;
}

/**
 * The request Next should see, or null when this Worker does not answer it. A public request is signed only when
 * OpenNext will forward it to an older version; any other leaves without a signature, whatever it came with.
 */
export async function skewRequest(request: Request, env: SkewHopEnv, now = Date.now()): Promise<Request | null> {
  const url = new URL(request.url);
  if (env.CF_WORKER_NAME && isPreviewHost(url.hostname)) {
    if (!(await signed(request, env, now))) return null;
    const headers = new Headers(request.headers);
    headers.delete(SKEW_SIGNATURE_HEADER);
    return withPublicHost(new Request(request, { headers }));
  }
  const out = withPublicHost(request);
  const build = request.headers.get('x-deployment-id') ?? url.searchParams.get('dpl');
  const hop = !!env.CF_WORKER_NAME && !!build && isOlderBuild(build, env) && isOwnHost(url.host, env);
  if (!hop && !request.headers.has(SKEW_SIGNATURE_HEADER)) return out;
  const headers = new Headers(out.headers);
  headers.delete(SKEW_SIGNATURE_HEADER);
  const key = hop ? await hopKey(env) : null;
  if (key) headers.set(SKEW_SIGNATURE_HEADER, toHex(await crypto.subtle.sign('HMAC', key, message(url.host, request.method, url, minuteOf(now)))));
  return new Request(out, { headers });
}
