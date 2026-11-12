/**
 * Boots the local E2E stack (docs/testing/LOCAL-STACK.md) in one Miniflare instance:
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts [--only a,b] [--check]
 *
 * 1. generates a local-only wrangler config per worker (configs.ts) next to its app
 *    (`wrangler.local-stack.json`, gitignored), so relative paths keep working;
 * 2. bundles each worker with `wrangler deploy --dry-run --outdir` (no Cloudflare call);
 * 3. starts every worker in ONE Miniflare: shared queues, Durable Objects, D1, R2, KV and Secrets
 *    Store, each worker on its own port; persisted state is fresh on every boot;
 * 4. applies every D1 migration (and the Auth repo's openauth migrations), fills the Secrets Store
 *    with local values, points the OAuth clients' redirect URIs at localhost;
 * 5. health-checks every port and writes `.local-stack/stack.json` (URLs, timings).
 *
 * `--check` stops the stack after the health check (CI boot timing); otherwise it runs until
 * SIGINT/SIGTERM. `--only` boots a subset (local debugging).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { parseJsonc } from '../release/jsonc.ts';
import { localConfig, localRedirectUris, type Json } from './configs.ts';
import { appDir, AUTH_DIR, HOST, localSecret, PORTS, PROD_HOST_TO_LOCAL, ROOT, STATE_DIR, url, WORKERS, type StackWorker } from './stack.ts';
import { outboundHandler } from './outbound.ts';
import { registerFakes, setStackSql, startFakeCdn } from './fake-external.ts';
import { startBrowserProxy } from './browser-proxy.ts';
import { assetsHandler } from './assets.ts';

const LOCAL_CONFIG = 'wrangler.local-stack.json';
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = option('--only')?.split(',').map((s) => s.trim()).filter(Boolean);

const log = (msg: string) => process.stderr.write(`[local-stack] ${msg}\n`);
const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - start;
    log(`${label}: ${((Date.now() - start) / 1000).toFixed(1)} s`);
  }
}

/** wrangler (and its miniflare) from this repo's install: apps/api-videos depends on it. */
const requireFromApi = createRequire(join(ROOT, 'apps/api-videos/package.json'));
const WRANGLER_PKG = requireFromApi.resolve('wrangler/package.json');
const wrangler = requireFromApi('wrangler') as {
  unstable_getMiniflareWorkerOptions: (configPath: string) => { workerOptions: Json };
  unstable_splitSqlQuery: (sql: string) => string[];
};
const { Miniflare } = createRequire(WRANGLER_PKG)('miniflare') as { Miniflare: new (opts: Json) => MiniflareInstance };

interface MiniflareInstance {
  ready: Promise<URL>;
  dispose(): Promise<void>;
  getD1Database(binding: string, worker?: string): Promise<D1>;
  getSecretsStoreSecretAPI(binding: string, worker?: string): Promise<() => { create(value: string): Promise<string> }>;
}
interface D1 {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> }; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
}

/** The wrangler CLI that bundles a worker: the worker's own repo install when it has one. */
function wranglerBin(worker: StackWorker): string {
  for (const base of [join(appDir(worker), 'package.json'), join(AUTH_DIR, 'package.json'), WRANGLER_PKG]) {
    try {
      const pkg = createRequire(base).resolve('wrangler/package.json');
      return join(pkg, '..', 'bin', 'wrangler.js');
    } catch {
      /* next */
    }
  }
  return join(WRANGLER_PKG, '..', 'bin', 'wrangler.js');
}

function readConfig(worker: StackWorker): Json {
  return parseJsonc(readFileSync(join(appDir(worker), worker.config), 'utf8')) as Json;
}

interface Prepared {
  worker: StackWorker;
  name: string;
  configPath: string;
  outDir: string;
  raw: Json;
  local: ReturnType<typeof localConfig>;
}

function selectWorkers(): StackWorker[] {
  const chosen: StackWorker[] = [];
  for (const worker of WORKERS) {
    if (only && !only.includes(worker.app)) continue;
    if (!existsSync(join(appDir(worker), worker.config))) {
      log(`skip ${worker.app}: ${relative(ROOT, join(appDir(worker), worker.config))} not found${worker.repo === 'auth' ? ' (check out the Auth repo: resolve-refs.ts)' : ''}`);
      continue;
    }
    if (worker.requires && !existsSync(join(appDir(worker), worker.requires))) {
      log(`skip ${worker.app}: not built (${worker.requires} missing)`);
      continue;
    }
    chosen.push(worker);
  }
  return chosen;
}

function prepare(workers: StackWorker[]): Prepared[] {
  const raws = workers.map((w) => ({ worker: w, raw: readConfig(w) }));
  const names = new Set(raws.map((r) => String(r.raw.name)));
  return raws.map(({ worker, raw }) => {
    const local = localConfig(raw, worker, names);
    const configPath = join(appDir(worker), LOCAL_CONFIG);
    writeFileSync(configPath, `${JSON.stringify(local.config, null, 2)}\n`);
    for (const d of local.dropped) log(`${worker.app}: dropped ${d}`);
    return { worker, name: String(raw.name), configPath, outDir: join(STATE_DIR, 'bundles', worker.app), raw, local };
  });
}

function bundle(p: Prepared): void {
  rmSync(p.outDir, { recursive: true, force: true });
  const result = spawnSync(process.execPath, [wranglerBin(p.worker), 'deploy', '--dry-run', '--outdir', p.outDir, '-c', LOCAL_CONFIG], {
    cwd: appDir(p.worker),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '', CI: process.env.CI ?? '' },
  });
  if (result.status !== 0) {
    throw new Error(`bundling ${p.worker.app} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Module type by extension, as wrangler uploads them (anything else is not a module). */
const MODULE_TYPES: [RegExp, string][] = [
  [/\.(m?js)$/, 'ESModule'],
  [/\.cjs$/, 'CommonJS'],
  [/\.wasm$/, 'CompiledWasm'],
  [/\.(txt|html|sql)$/, 'Text'],
  [/\.bin$/, 'Data'],
];

/** Every module wrangler emitted, entry first (an explicit list: Miniflare does not walk imports, so node: built-ins stay runtime imports). */
function bundleModules(outDir: string): { type: string; path: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!entry.name.endsWith('.map') && entry.name !== 'README.md') files.push(path);
    }
  };
  walk(outDir);
  const entry = ['index.js', 'worker.js'].map((f) => join(outDir, f)).find((f) => files.includes(f));
  if (!entry) throw new Error(`no bundle in ${outDir} (${files.join(', ') || 'empty'})`);
  return [entry, ...files.filter((f) => f !== entry)].flatMap((path) => {
    const type = MODULE_TYPES.find(([re]) => re.test(path))?.[1];
    return type ? [{ type, path }] : [];
  });
}

/**
 * workerd treats every named export of the entry module as an entrypoint and refuses one that is
 * not a handler (api-videos exports a cron string). The deployed runtime ignores those, so the
 * local entry re-exports only the default handler and the Durable Object classes this worker hosts.
 */
function writeEntry(p: Prepared, modules: { type: string; path: string }[]): { type: string; path: string }[] {
  const dos = ((p.local.config.durable_objects as { bindings?: Json[] } | undefined)?.bindings ?? [])
    .filter((b) => !b.script_name)
    .map((b) => String(b.class_name));
  const classes = [...new Set(dos)];
  const entryPath = join(p.outDir, '__local_stack_entry.mjs');
  const target = `./${relative(p.outDir, modules[0].path)}`;
  writeFileSync(
    entryPath,
    [`export { default } from ${JSON.stringify(target)};`, ...(classes.length ? [`export { ${classes.join(', ')} } from ${JSON.stringify(target)};`] : [])].join('\n') + '\n',
  );
  return [{ type: 'ESModule', path: entryPath }, ...modules];
}

function workerOptions(p: Prepared): Json {
  const { workerOptions: options } = wrangler.unstable_getMiniflareWorkerOptions(p.configPath);
  // Static assets from Node, per worker: Miniflare's assets services share one storage service
  // between workers, so a second app's assets answer 500 (assets.ts)
  const { assets, ...rest } = options as Json & { assets?: { directory: string; binding?: string } };
  const serviceBindings = { ...((rest.serviceBindings as Json | undefined) ?? {}) };
  if (assets?.binding) serviceBindings[assets.binding] = assetsHandler(assets.directory);
  return {
    ...rest,
    serviceBindings,
    name: p.name,
    modulesRoot: p.outDir,
    modules: writeEntry(p, bundleModules(p.outDir)),
    unsafeDirectSockets: [{ host: '127.0.0.1', port: PORTS[p.worker.app] }],
    outboundService: outboundHandler,
  };
}

/** Every D1 database (by id) with its migration dirs, auth's openauth migrations first. */
function migrationPlan(prepared: Prepared[]): { worker: string; binding: string; label: string; dirs: string[] }[] {
  const plan = new Map<string, { worker: string; binding: string; label: string; dirs: string[] }>();
  for (const p of prepared) {
    for (const db of (p.local.config.d1_databases as Json[] | undefined) ?? []) {
      const id = String(db.database_id ?? db.database_name);
      const entry = plan.get(id) ?? { worker: p.name, binding: String(db.binding), label: String(db.database_name ?? id), dirs: [] };
      if (db.migrations_dir) {
        if (p.worker.app === 'auth') {
          const openauth = join(appDir(p.worker), 'node_modules/@al-ummah-now/openauth/src/migrations');
          if (existsSync(openauth)) entry.dirs.unshift(openauth);
          else log('auth: @al-ummah-now/openauth migrations not found (install the Auth repo)');
          entry.worker = p.name;
          entry.binding = String(db.binding);
        }
        const dir = join(appDir(p.worker), String(db.migrations_dir));
        if (!entry.dirs.includes(dir)) entry.dirs.push(dir);
      }
      plan.set(id, entry);
    }
  }
  return [...plan.values()].filter((e) => e.dirs.length > 0);
}

async function migrate(mf: MiniflareInstance, prepared: Prepared[]): Promise<void> {
  for (const entry of migrationPlan(prepared)) {
    const db = await mf.getD1Database(entry.binding, entry.worker);
    let count = 0;
    for (const dir of entry.dirs) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const statements = wrangler.unstable_splitSqlQuery(readFileSync(join(dir, file), 'utf8'));
        for (const sql of statements) {
          try {
            await db.prepare(sql).run();
          } catch (error) {
            throw new Error(`${entry.label}: ${relative(ROOT, join(dir, file))} failed: ${(error as Error).message}\n${sql.slice(0, 300)}`);
          }
        }
        count++;
      }
    }
    log(`migrated ${entry.label} (${count} files)`);
  }
}

async function fillSecrets(mf: MiniflareInstance, prepared: Prepared[]): Promise<void> {
  const done = new Set<string>();
  for (const p of prepared) {
    for (const s of p.local.secrets) {
      const key = `${s.storeId}/${s.secretName}`;
      if (done.has(key)) continue;
      const api = await mf.getSecretsStoreSecretAPI(s.binding, p.name);
      await api().create(localSecret(s.binding, s.secretName));
      done.add(key);
    }
  }
  log(`secrets store: ${done.size} local values`);
}

/** Every OAuth client's redirect URIs point at the local apps (deployed hosts rewritten, unknown dropped). */
async function localClients(mf: MiniflareInstance, prepared: Prepared[]): Promise<void> {
  const auth = prepared.find((p) => p.worker.app === 'auth');
  if (!auth) return;
  const db = await mf.getD1Database('AUTH_DB', auth.name);
  const { results } = await db.prepare('SELECT id, redirect_uris FROM oauth_clients').all<{ id: string; redirect_uris: string | null }>();
  for (const row of results) {
    let uris: string[] = [];
    try {
      uris = JSON.parse(row.redirect_uris ?? '[]') as string[];
    } catch {
      continue;
    }
    const local = localRedirectUris(uris, PROD_HOST_TO_LOCAL);
    await db.prepare('UPDATE oauth_clients SET redirect_uris = ? WHERE id = ?').bind(JSON.stringify(local), row.id).run();
  }
  log(`auth: ${results.length} OAuth clients point at localhost`);
}

async function health(prepared: Prepared[]): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {};
  const deadline = Date.now() + 120_000;
  for (const p of prepared) {
    const target = `http://127.0.0.1:${PORTS[p.worker.app]}/`;
    for (;;) {
      try {
        const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
        statuses[p.worker.app] = res.status;
        if (res.status < 500) break;
      } catch {
        statuses[p.worker.app] = 0;
      }
      if (Date.now() > deadline) throw new Error(`${p.worker.app} unhealthy at ${target} (status ${statuses[p.worker.app]})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return statuses;
}

async function main(): Promise<void> {
  const started = Date.now();
  const persist = join(STATE_DIR, 'state');
  // stack.json means "ready": never leave the previous boot's
  rmSync(join(STATE_DIR, 'stack.json'), { force: true });
  rmSync(persist, { recursive: true, force: true });
  mkdirSync(persist, { recursive: true });

  const workers = selectWorkers();
  if (workers.length === 0) throw new Error('no workers to boot');
  const prepared = await timed('configs', () => prepare(workers));
  await timed('bundle', async () => {
    for (const p of prepared) await timed(`bundle ${p.worker.app}`, () => bundle(p));
  });
  const options = prepared.map(workerOptions);

  registerFakes();
  const stopCdn = await timed('fake cdn', () => startFakeCdn());
  const stopProxy = await timed('browser proxy', () => startBrowserProxy());
  const mf = await timed('miniflare', async () => {
    const instance = new Miniflare({ workers: options, defaultPersistRoot: persist, log: undefined });
    await instance.ready;
    return instance;
  });
  const stop = async () => {
    log('stopping');
    await mf.dispose();
    await stopCdn();
    await stopProxy();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await timed('migrations', () => migrate(mf, prepared));
  const databases = new Map<string, { binding: string; worker: string }>();
  for (const p of prepared) for (const db of (p.local.config.d1_databases as Json[] | undefined) ?? []) if (!databases.has(String(db.database_name))) databases.set(String(db.database_name), { binding: String(db.binding), worker: p.name });
  setStackSql(async (name, sql) => {
    const target = databases.get(name);
    if (!target) throw new Error(`no database ${name} (${[...databases.keys()].join(', ')})`);
    const db = await mf.getD1Database(target.binding, target.worker);
    return (await db.prepare(sql).all<unknown>()).results;
  });
  await timed('secrets', () => fillSecrets(mf, prepared));
  await timed('clients', () => localClients(mf, prepared));
  const statuses = await timed('health', () => health(prepared));
  timings.total = Date.now() - started;

  const apps = Object.fromEntries(prepared.map((p) => [p.worker.app, { url: url(p.worker.app), worker: p.name, health: statuses[p.worker.app] }]));
  writeFileSync(join(STATE_DIR, 'stack.json'), `${JSON.stringify({ host: HOST, apps, timings, ready: new Date().toISOString() }, null, 2)}\n`);
  log(`ready in ${(timings.total / 1000).toFixed(1)} s: ${prepared.map((p) => `${p.worker.app} ${url(p.worker.app)}`).join(', ')}`);
  if (flag('--check')) await stop();
}

main().catch((error) => {
  log(`FAILED: ${(error as Error).stack ?? error}`);
  process.exit(1);
});
