/**
 * Everything the admin suite creates is deleted again (owner rule 2026-11-12), pass or fail:
 *
 * - Specs delete what they made in afterAll (channels, tiers, invites, R2 records), through the
 *   admin's own delete + purge where it has one.
 * - global-teardown.ts then runs teardownRun(): every account this job registered (the ledger) has
 *   its videos data erased with the product's own GDPR delete (DELETE /api/privacy/data) and its
 *   auth account deleted (auth's run-account route); every e2e report of this job is dismissed and,
 *   on the local stack, removed, with the admin audit rows and role/tier rows its accounts left.
 * - The workflow then fails the job if anything carrying the run id is left on the stack
 *   (scripts/local-stack/leftovers.ts).
 *
 * Every step is idempotent: a second teardown, or one after a spec already cleaned up, deletes
 * nothing and fails nothing. Swap for the shared builders' cleanup() once they cover these kinds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_DIR, E2E_ENTITY_PREFIX, LOCAL_STACK, OPENAUTH_URL, RUN_ID, VIDEOS_API_URL, runPassword, type Account } from './env';
import { getAccessToken } from './oauth';
import { eraseRowsMentioning, queueErasureStep, runCron, stackLeftovers, stackR2, stackR2Keys, stackSql, topOfHour } from './local-stack';
import { adminApi } from './api';
import { ARCHIVE_BUCKETS, archiveHits, processorBatchTimeoutMs, quietPeriodState, type QuietPeriod } from './archive-hits';
import { parseJsonc } from './jsonc';

const LEDGER = path.join(AUTH_DIR, 'run-ledger.jsonl');

interface LedgerUser { email: string; userId: string }

/** Records an account this job registered (any worker; read by the global teardown). */
export function recordRunAccount(email: string, userId: string): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.appendFileSync(LEDGER, `${JSON.stringify({ email, userId })}\n`);
}

/** Appends the job's run-user ids, one per line, for the leftover check (its users are gone by then). */
export function writeRunUserIds(file: string): void {
  const ids = ledgerUsers().map((u) => u.userId);
  if (ids.length) fs.appendFileSync(file, `${ids.join('\n')}\n`);
}

export function ledgerUsers(): LedgerUser[] {
  if (!fs.existsSync(LEDGER)) return [];
  const byEmail = new Map<string, LedgerUser>();
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as LedgerUser;
    byEmail.set(entry.email.toLowerCase(), entry);
  }
  return [...byEmail.values()];
}

/**
 * Deletes a channel and asks for its permanent deletion (the Recently deleted "Delete permanently
 * now"), as an admin would. Idempotent: an already deleted or purged channel answers 404/409.
 */
export async function purgeChannel(id: string, token?: string): Promise<void> {
  const path = encodeURIComponent(id);
  const del = await adminApi(`/api/content/channels/${path}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e cleanup' }), ...(token ? { token } : {}) });
  if (del.status >= 300 && del.status !== 404) throw new Error(`delete channel ${id} -> ${del.status}`);
  const purge = await adminApi(`/api/content/deletions/channel/${path}/purge`, { method: 'POST', body: '{}', ...(token ? { token } : {}) });
  if (purge.status >= 300 && purge.status !== 404 && purge.status !== 409) throw new Error(`purge channel ${id} -> ${purge.status}`);
}

/** Erases the account's videos data with the product's GDPR delete; false when it can no longer sign in (already deleted). */
export async function eraseVideosData(account: Account): Promise<boolean> {
  let token: string;
  try {
    token = await getAccessToken(account);
  } catch {
    return false;
  }
  await eraseVideosDataWithToken(token, account.email);
  return true;
}

/**
 * The account's own "Delete my data" (DELETE /api/privacy/data, resumed until complete) with an
 * access token the caller already has. For accounts with no password to sign in with, such as an
 * invited creator who was signed in straight from the invite link: the spec that signed them in
 * erases them, since the global teardown cannot (#1611).
 */
export async function eraseVideosDataWithToken(token: string, label: string): Promise<void> {
  let resumeToken: string | undefined;
  for (let round = 0; round < 20; round++) {
    const res = await fetch(`${VIDEOS_API_URL}/api/privacy/data`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: 'DELETE', ...(resumeToken ? { resumeToken } : {}) }),
    });
    if (!res.ok) throw new Error(`erasing ${label}'s videos data -> ${res.status}`);
    const body = (await res.json()) as { complete?: boolean; resumeToken?: string };
    if (body.complete) return;
    resumeToken = body.resumeToken;
  }
  throw new Error(`erasing ${label}'s videos data did not complete in 20 rounds`);
}

/**
 * Deletes a run account on the auth server (soft delete + immediate purge, the route
 * scripts/e2e/teardown-run-users.ts uses on QA/stage). Idempotent: an absent account is fine.
 */
async function deleteAuthAccount(email: string): Promise<'deleted' | 'absent'> {
  const sink = process.env.E2E_CODE_SINK_SECRET;
  const promote = process.env.TEST_PROMOTE_SECRET;
  if (!sink || !promote) throw new Error('E2E_CODE_SINK_SECRET and TEST_PROMOTE_SECRET are required to delete run accounts');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${OPENAUTH_URL}/test/run-users/delete/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'X-E2E-Secret': sink, 'X-Test-Secret': promote },
    });
    if (res.ok) return ((await res.json().catch(() => ({}))) as { found?: number }).found ? 'deleted' : 'absent';
    if (res.status < 500 || attempt >= 4) throw new Error(`auth delete -> ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

/** Local stack only: removes these reports (no-op elsewhere; QA keeps them dismissed). */
export async function deleteLocalReports(ids: string[]): Promise<void> {
  if (!LOCAL_STACK || !ids.length) return;
  const list = ids.filter((id) => /^[A-Za-z0-9_:.-]{1,128}$/.test(id)).map((id) => `'${id}'`).join(', ');
  if (list) await stackSql('al-ummah-now-reports', `DELETE FROM reports WHERE id IN (${list})`);
}

const quoteList = (values: string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

/**
 * Local stack only: rows with no delete in the product (reports are never deleted, the admin audit
 * log is append-only) and role/tier rows of this job's accounts, removed through the stack's SQL.
 */
async function eraseLocalRows(users: LedgerUser[]): Promise<void> {
  if (!LOCAL_STACK || !RUN_ID) return;
  const ids = users.map((u) => u.userId).filter((id) => /^[A-Za-z0-9_:.-]{1,128}$/.test(id));
  const prefix = E2E_ENTITY_PREFIX.replace(/'/g, "''");
  const marker = `%${RUN_ID}%`;
  await stackSql('al-ummah-now-reports', `DELETE FROM reports WHERE entity_id LIKE '${prefix}%'`);
  await stackSql('al-ummah-now-reports', `DELETE FROM moderation_actions WHERE subject_id LIKE '${prefix}%'`);
  await stackSql('al-ummah-now-reports', `DELETE FROM admin_audit_log WHERE actor_email LIKE '${marker}' OR target_id LIKE '${marker}' OR metadata LIKE '${marker}'${ids.length ? ` OR actor_id IN (${quoteList(ids)}) OR target_id IN (${quoteList(ids)})` : ''}`);
  if (!ids.length) return;
  await stackSql('al-ummah-now-reports', `DELETE FROM site_settings_log WHERE actor_id IN (${quoteList(ids)})`);
  // The videos admin's staff list: each run admin's token recorded it (admin-api lib/admin-staff.ts)
  await stackSql('al-ummah-now-reports', `DELETE FROM admin_staff WHERE user_id IN (${quoteList(ids)})`);
  await stackSql('al-ummah-now-reports', `DELETE FROM auth_moderation_requests WHERE subject_user_id IN (${quoteList(ids)}) OR requested_by_id IN (${quoteList(ids)})`);
  await stackSql('al-ummah-now-search', `DELETE FROM creator_tier_assignments WHERE user_id IN (${quoteList(ids)})`);
  await stackSql('al-ummah-now-d1', `DELETE FROM rbac_user_roles WHERE user_id IN (${quoteList(ids)})`);
  // Auth's moderation records of requests this job's admin sent about its own accounts (12-auth-requests):
  // an audit trail on deployments (user id only, no email), this run's test data here; events first
  const requests = `SELECT id FROM moderation_requests WHERE subject_user_id IN (${quoteList(ids)}) OR requested_by_id IN (${quoteList(ids)})`;
  await stackSql('al-ummah-now-d1', `DELETE FROM moderation_request_events WHERE request_id IN (${requests})`);
  await stackSql('al-ummah-now-d1', `DELETE FROM moderation_requests WHERE id IN (${requests})`);
}

/**
 * Local stack only, after the purges: what the product keeps as history or copies, found by the
 * run id and the run users' ids. R2: api-videos' report copies (report:<entity id>:…), the run
 * users' profile records, and the processor's message archive and legacy-restore backups that
 * mention the run. D1: job, deletion, tombstone and search rows of the run's channels and users.
 */
async function eraseLocalCopies(users: LedgerUser[]): Promise<void> {
  if (!LOCAL_STACK || !RUN_ID) return;
  const markers = [RUN_ID, ...users.map((u) => u.userId)];
  for (const key of await stackR2Keys('reports', `report:${E2E_ENTITY_PREFIX}`)) await stackR2('DELETE', 'reports', key);
  for (const user of users) await stackR2('DELETE', 'profiles', user.userId);
  for (const bucket of ARCHIVE_BUCKETS) {
    const keys = await stackR2Keys(bucket);
    for (let i = 0; i < keys.length; i += 20) {
      await Promise.all(keys.slice(i, i + 20).map(async (key) => {
        const res = await stackR2('GET', bucket, key);
        const text = res.ok ? await res.text() : '';
        if (markers.some((m) => key.includes(m) || text.includes(m))) await stackR2('DELETE', bucket, key);
      }));
    }
  }
  // Errors surface (the teardown fails): a sweep that silently did nothing hid leftovers before
  // Errors the run's users raised (error_events.user_id, error_group_users.user_key): kept by the errors
  // retention when deployed, this run's test data here
  for (const table of ['site_settings_log', 'admin_audit_log', 'error_events', 'error_group_users']) await eraseRowsMentioning('al-ummah-now-reports', table, markers);
  for (const table of ['admin_jobs', 'admin_deletions', 'search_tombstones', 'search_channels', 'search_meta', 'content_ownership', 'channel_access', 'upload_rate_windows']) {
    await eraseRowsMentioning('al-ummah-now-search', table, markers);
  }
}

/** apps/processor/wrangler.jsonc: its queue batch timeout sets how long a late message copy can take. */
const PROCESSOR_CONFIG = path.resolve(__dirname, '../../../processor/wrangler.jsonc');

/** Revocations outlive the tokens on purpose (the job's leftover check allows them too). */
const KEPT_ON_PURPOSE = (h: { store: string; location: string }) =>
  h.store === 'kv:TOKEN_REVOCATIONS' || (h.store === 'd1:al-ummah-now-d1' && h.location.startsWith('user_revocations'));

/**
 * Sweeps until the stack holds nothing of this run but revocations, so queued erasure steps finish
 * before the leftover check. Message-archive and backup copies the processor writes after
 * eraseLocalCopies swept (a report dismissed as the last spec ended) are deleted as each scan finds
 * them (archive-hits.ts), until none new has appeared for ARCHIVE_QUIET_MS past the processor's
 * batch window (quietPeriodState). Throws at the hard limit with what is left.
 */
async function waitForErasure(users: LedgerUser[], log: (line: string) => void, startedAt: number): Promise<void> {
  if (!LOCAL_STACK || !RUN_ID) return;
  const ids = users.map((u) => u.userId);
  const period: QuietPeriod = { startedAt, batchMs: processorBatchTimeoutMs(parseJsonc(fs.readFileSync(PROCESSOR_CONFIG, 'utf8'))) };
  const seen = new Set<string>();
  let lastNewArchiveAt: number | null = null;
  for (;;) {
    const left = (await stackLeftovers(RUN_ID, ids)).filter((h) => !KEPT_ON_PURPOSE(h));
    const late = archiveHits(left);
    const fresh = late.filter(({ bucket, key }) => !seen.has(`${bucket}/${key}`));
    if (fresh.length) lastNewArchiveAt = Date.now();
    if (late.length) {
      await Promise.all(late.map(({ bucket, key }) => stackR2('DELETE', bucket, key)));
      for (const { bucket, key } of late) seen.add(`${bucket}/${key}`);
      log(`[teardown] deleted ${late.length} message copies archived after the sweep`);
    }
    const other = left.filter((h) => !archiveHits([h]).length);
    const state = quietPeriodState(period, Date.now(), lastNewArchiveAt, other.length);
    if (state === 'done') return;
    if (state === 'timeout') {
      const names = [...other.map((h) => `${h.store} ${h.location}`), ...(fresh.length ? [`message copies still being archived (${fresh.length} new in the last scan)`] : [])];
      throw new Error(`still on the stack ${Math.round((Date.now() - startedAt) / 1000)} s into the teardown: ${names.slice(0, 10).join('; ') || 'message copies still being archived'}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * The job's whole teardown (global-teardown.ts). Accounts go last: the admin's token is what the
 * report and row clean-ups use.
 */
export async function teardownRun(log: (line: string) => void = () => undefined): Promise<void> {
  if (!RUN_ID) return;
  const started = Date.now();
  const users = ledgerUsers();
  if (process.env.E2E_RUN_USER_IDS_FILE) writeRunUserIds(process.env.E2E_RUN_USER_IDS_FILE);
  const problems: string[] = [];
  // Accounts the GDPR delete could not reach (no password: an invited creator never set one)
  const unreached: LedgerUser[] = [];
  try {
    await eraseLocalRows(users);
  } catch (error) {
    problems.push(`local rows: ${(error as Error).message}`);
  }
  for (const user of users) {
    try {
      const erased = await eraseVideosData({ role: 'nonadmin', email: user.email, password: runPassword() });
      if (!erased) unreached.push(user);
      log(`[teardown] ${user.email}: videos data ${erased ? 'erased' : 'already gone'}`);
    } catch (error) {
      problems.push(`${user.email}: ${(error as Error).message}`);
    }
  }
  // QA/stage: the workflow's teardown step deletes the auth accounts (scripts/e2e/teardown-run-users.ts)
  if (LOCAL_STACK) {
    for (const user of users) {
      try {
        log(`[teardown] ${user.email}: auth account ${await deleteAuthAccount(user.email)}`);
      } catch (error) {
        problems.push(`${user.email}: ${(error as Error).message}`);
      }
    }
    // The purges the specs requested (channels, creator tiers, invites) run on the crons: run them now
    for (const [app, cron, time] of [['api-videos', '47 * * * *', new Date()], ['admin-api', '*/5 * * * *', topOfHour()]] as const) {
      await runCron(app, cron, time).catch((error) => problems.push((error as Error).message));
    }
    // Accounts that could not sign in to erase themselves (an invited creator has no password): the
    // erasure's processor step for them, which removes their invite, caption-minute and job-link
    // rows (processor erasure/user-traces.ts). Their channels are the specs' own and already purged;
    // their profile record goes in eraseLocalCopies below.
    for (const user of unreached) {
      await queueErasureStep(user.userId)
        .then(() => log(`[teardown] ${user.email}: erasure step queued`))
        .catch((error) => problems.push((error as Error).message));
    }
    // Roles and tiers once more: deleting the account may have re-read them
    await eraseLocalRows(users).catch((error) => problems.push(`local rows: ${(error as Error).message}`));
    await eraseLocalCopies(users).catch((error) => problems.push(`local copies: ${(error as Error).message}`));
    // The erasure's processor steps (UserDataErased: invites, error rows, category suggestions) run
    // from the queue: wait until they are done before the job's leftover check looks
    await waitForErasure(users, log, started).catch((error) => problems.push(`erasure: ${(error as Error).message}`));
  }
  if (problems.length) throw new Error(`teardown left things behind:\n${problems.join('\n')}`);
}
