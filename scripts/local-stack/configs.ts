/**
 * Local-only wrangler configs for the E2E stack, generated from each app's top-level wrangler file.
 *
 * The checked-in top-level configs are the PRODUCTION configs for most workers, and many bindings
 * say `remote: true`, which makes `wrangler dev` use the real buckets and databases. The generated
 * config keeps the binding SHAPES (names, queue names, database ids, so workers that share a
 * resource in production share it locally) and drops everything that reaches Cloudflare: remote
 * flags, preview ids, routes, environments, Workers AI, containers and bindings to workers that
 * are not in the stack. Var overrides point every URL at the local stack (stack.ts).
 *
 * Pure functions, unit-tested in __tests__/configs.test.ts.
 */
import type { StackWorker } from './stack.ts';

export type Json = Record<string, unknown>;

/** Top-level keys that only matter to a deploy (or reach Cloudflare): never in a local config. */
const DROP_KEYS = [
  '$schema', 'env', 'routes', 'route', 'triggers', 'observability', 'dev', 'ai', 'tail_consumers', 'containers',
  'upload_source_maps', 'workers_dev', 'preview_urls', 'placement', 'limits', 'logpush', 'send_metrics', 'account_id',
  'compliance_region', 'build', 'vectorize', 'hyperdrive', 'browser', 'mtls_certificates', 'dispatch_namespaces',
  'workflows', 'images', 'pipelines', 'send_email',
];

/** Per-binding keys that point at remote or preview resources. */
const DROP_BINDING_KEYS = ['remote', 'preview_id', 'preview_database_id', 'preview_bucket_name', 'jurisdiction', 'experimental_remote'];

function cleanBindings(list: unknown): Json[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((entry) => {
    const copy: Json = { ...(entry as Json) };
    for (const key of DROP_BINDING_KEYS) delete copy[key];
    return copy;
  });
}

export interface LocalConfigResult {
  config: Json;
  /** Secrets Store bindings to fill with local values after boot. */
  secrets: { binding: string; storeId: string; secretName: string }[];
  /** What was dropped and why, for the boot log. */
  dropped: string[];
}

/**
 * The local config for one worker. `stackWorkerNames` are the wrangler `name`s of every worker in
 * the stack (service and Durable Object bindings to other scripts are kept only for those).
 */
export function localConfig(raw: Json, worker: StackWorker, stackWorkerNames: Set<string>): LocalConfigResult {
  const config: Json = { ...raw };
  const dropped: string[] = [];
  for (const key of DROP_KEYS) {
    if (key in config) {
      dropped.push(key);
      delete config[key];
    }
  }
  if (worker.main) config.main = worker.main;

  for (const key of ['d1_databases', 'kv_namespaces', 'r2_buckets']) {
    const cleaned = cleanBindings(config[key]);
    if (cleaned) config[key] = cleaned;
  }

  if (Array.isArray(config.services)) {
    const kept = (config.services as Json[]).filter((s) => stackWorkerNames.has(String(s.service)));
    for (const s of config.services as Json[]) if (!kept.includes(s)) dropped.push(`service ${String(s.binding)} → ${String(s.service)} (not in the stack)`);
    config.services = kept.map((s) => {
      const copy = { ...s };
      delete copy.remote;
      return copy;
    });
  }

  const dos = config.durable_objects as { bindings?: Json[] } | undefined;
  if (dos?.bindings) {
    const kept = dos.bindings.filter((b) => !b.script_name || stackWorkerNames.has(String(b.script_name)));
    for (const b of dos.bindings) if (!kept.includes(b)) dropped.push(`durable object ${String(b.name)} → ${String(b.script_name)} (not in the stack)`);
    config.durable_objects = { ...dos, bindings: kept };
  }

  const queues = config.queues as { producers?: Json[]; consumers?: Json[] } | undefined;
  if (queues) {
    config.queues = {
      ...(queues.producers ? { producers: queues.producers.map(({ remote: _r, ...p }) => p) } : {}),
      ...(queues.consumers ? { consumers: queues.consumers } : {}),
    };
  }

  const secrets: LocalConfigResult['secrets'] = [];
  if (Array.isArray(config.secrets_store_secrets)) {
    for (const s of config.secrets_store_secrets as Json[]) {
      secrets.push({ binding: String(s.binding), storeId: String(s.store_id), secretName: String(s.secret_name) });
    }
  }

  config.vars = { ...((config.vars as Json | undefined) ?? {}), ...worker.vars };
  return { config, secrets, dropped };
}

/** Rewrites one OAuth redirect URI's deployed host to its local origin; null when it has no local counterpart. */
export function localRedirectUri(uri: string, hostMap: Record<string, string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return uri;
  if (parsed.protocol !== 'https:') return null;
  const local = hostMap[parsed.hostname];
  if (!local) return null;
  return `${local}${parsed.pathname}${parsed.search}`;
}

/** A client's redirect URIs with deployed hosts made local (deduplicated, unknown hosts dropped). */
export function localRedirectUris(uris: string[], hostMap: Record<string, string>): string[] {
  const out: string[] = [];
  for (const uri of uris) {
    const local = localRedirectUri(uri, hostMap);
    if (local && !out.includes(local)) out.push(local);
  }
  return out;
}
