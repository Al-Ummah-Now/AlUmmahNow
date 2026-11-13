/**
 * End-of-job teardown of a web or release suite on the local stack, after the run accounts are
 * deleted on the issuer and before the gating leftover check (leftovers.ts). The admin suite does
 * the same in its global teardown (apps/admin-web/e2e/support/cleanup.ts).
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/run-teardown.ts --marker "$E2E_RUN_ID" [--wait-seconds 180]
 *
 * 1. Runs the crons the deployed environments run on their own (the stack runs none):
 *    - api-videos' run-account sweep (every 10 minutes, lib/e2e/runUserSweep.ts): erases the videos
 *      data of run accounts whose auth account is gone. Specs that sign up through the web page
 *      (signUpOnWeb) leave their profile, channels and videos to it, as they do on QA and stage.
 *    - api-videos' deletion cleanup (hourly): runs the purges creators and admins queued.
 *    - admin-api's trash cleanup (top of the hour): purges contact messages an admin deleted
 *      permanently (Recently deleted).
 * 2. Waits until the erasures' queued steps are done (the processor's UserDataErased step deletes
 *    notifications, category suggestions, error rows and rate windows; expiring caches lapse):
 *    polls the leftover scan until it holds nothing but the kept-on-purpose and history kinds.
 * 3. Removes this run's rows from the stores the product keeps as history (HISTORY below), found by
 *    the scan: the run's own test data, never allowed through.
 *
 * Never fails the job: the Leftovers step after it does, with the list of what is left.
 */
import { existsSync, readFileSync } from 'node:fs';

interface Hit { store: string; location: string; sample: string }

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const marker = value('--marker') ?? process.env.E2E_RUN_ID ?? '';
const waitSeconds = Number(value('--wait-seconds') ?? 180);
const control = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';

/** Kept on purpose: revocations outlive the tokens (user id only); tombstones (entity + id) keep a deleted item from coming back. */
export function keptOnPurpose(hit: Pick<Hit, 'store' | 'location'>): boolean {
  return (
    hit.store === 'kv:TOKEN_REVOCATIONS' ||
    (hit.store === 'd1:al-ummah-now-d1' && hit.location === 'user_revocations') ||
    (hit.store === 'd1:al-ummah-now-search' && hit.location === 'search_tombstones')
  );
}

/**
 * What the product keeps as history, by design, with the run's test data in it. Deleted here, row by
 * row, by its primary key: admin jobs and deletions (30-day restore registry, purged rows kept), the
 * admin audit logs and the queue-message archive (pseudonymised: the run's hits there are its own
 * video and channel titles).
 */
export const HISTORY: Record<string, { table: string; key: string[] }[] | 'r2'> = {
  'd1:al-ummah-now-search': [
    { table: 'admin_jobs', key: ['id'] },
    { table: 'admin_deletions', key: ['kind', 'target_id'] },
  ],
  'd1:al-ummah-now-reports': [
    { table: 'admin_audit_log', key: ['id'] },
    { table: 'site_settings_log', key: ['id'] },
  ],
  'r2:al-ummah-now-messages': 'r2',
};

export function isHistory(hit: Pick<Hit, 'store' | 'location'>): boolean {
  const kind = HISTORY[hit.store];
  if (kind === 'r2') return true;
  return !!kind && kind.some((t) => t.table === hit.location);
}

const quote = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * DELETE statements for the history rows among `hits`, by primary key (from each row's JSON), one
 * per table and chunk of 50 rows (the stack's SQL route runs one statement per request).
 */
export function historyDeletes(hits: Hit[]): { database: string; sql: string }[] {
  const byTable = new Map<string, { database: string; table: string; where: string[] }>();
  for (const hit of hits) {
    const tables = HISTORY[hit.store];
    if (!tables || tables === 'r2') continue;
    const table = tables.find((t) => t.table === hit.location);
    if (!table) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(hit.sample) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (table.key.some((k) => row[k] === undefined || row[k] === null)) continue;
    const id = `${hit.store} ${table.table}`;
    const entry = byTable.get(id) ?? { database: hit.store.slice('d1:'.length), table: table.table, where: [] };
    entry.where.push(`(${table.key.map((k) => `${k} = ${quote(row[k])}`).join(' AND ')})`);
    byTable.set(id, entry);
  }
  const out: { database: string; sql: string }[] = [];
  for (const { database, table, where } of byTable.values()) {
    for (let i = 0; i < where.length; i += 50) out.push({ database, sql: `DELETE FROM ${table} WHERE ${where.slice(i, i + 50).join(' OR ')}` });
  }
  return out;
}

function runUserIds(): string[] {
  const file = process.env.E2E_RUN_USER_IDS_FILE;
  if (!file || !existsSync(file)) return [];
  return [...new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))];
}

async function scan(): Promise<Hit[]> {
  const ids = runUserIds();
  const res = await fetch(`${control}/__stack/leftovers?limit=20000&marker=${encodeURIComponent(marker)}${ids.length ? `&ids=${encodeURIComponent(ids.join(','))}` : ''}`);
  if (!res.ok) throw new Error(`leftover scan -> ${res.status} ${await res.text()}`);
  return ((await res.json()) as { hits: Hit[] }).hits;
}

async function cron(app: string, expr: string, time = new Date()): Promise<void> {
  const res = await fetch(`${control}/__stack/scheduled/${app}?cron=${encodeURIComponent(expr)}&time=${encodeURIComponent(time.toISOString())}`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
  log(`cron ${app} "${expr}": ${res.status} ${body.outcome ?? body.error ?? ''}`);
}

function log(line: string): void {
  process.stdout.write(`[run-teardown] ${line}\n`);
}

const topOfHour = () => {
  const t = new Date();
  t.setUTCMinutes(0, 0, 0);
  return t;
};

async function main(): Promise<void> {
  if (marker.length < 6) throw new Error('--marker <run id> (or E2E_RUN_ID) is required');
  const pending = (hits: Hit[]) => hits.filter((h) => !keptOnPurpose(h) && !isHistory(h));
  const deadline = Date.now() + waitSeconds * 1000;
  let left: Hit[] = [];
  for (let round = 0; ; round++) {
    // Each round runs the crons again: a sweep or purge job may have been mid-way the round before
    await cron('api-videos', '47 * * * *');
    await cron('api-videos', '*/10 * * * *');
    await cron('admin-api', '*/5 * * * *', topOfHour());
    for (let poll = 0; poll < 6; poll++) {
      await new Promise((r) => setTimeout(r, 5000));
      left = pending(await scan());
      if (!left.length || Date.now() > deadline) break;
    }
    if (!left.length || Date.now() > deadline) break;
    log(`round ${round + 1}: ${left.length} still pending (${[...new Set(left.map((h) => `${h.store} ${h.location.split('/')[0]}`))].slice(0, 8).join('; ')})`);
  }
  if (left.length) log(`gave up waiting after ${waitSeconds} s with ${left.length} pending; the leftover check lists them`);

  const history = (await scan()).filter(isHistory);
  for (const { database, sql } of historyDeletes(history)) {
    const res = await fetch(`${control}/__stack/d1/${encodeURIComponent(database)}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: sql });
    log(`history rows in ${database}: ${res.ok ? 'deleted' : `${res.status} ${await res.text()}`}`);
  }
  const objects = history.filter((h) => HISTORY[h.store] === 'r2');
  for (let i = 0; i < objects.length; i += 20) {
    await Promise.all(
      objects.slice(i, i + 20).map((h) =>
        fetch(`${control}/__stack/r2/${encodeURIComponent(h.store.slice('r2:'.length))}/${encodeURIComponent(h.location)}`, { method: 'DELETE' }),
      ),
    );
  }
  log(`removed ${history.length} history entries of run ${marker} (${objects.length} archived messages)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    log(`failed: ${error.message}`);
  });
}
