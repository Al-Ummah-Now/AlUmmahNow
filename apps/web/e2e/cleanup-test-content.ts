/**
 * Deletes videos owned by the E2E test users (test-single/multi/none/scratch-*)
 * for good: to the trash, then purged (record, media and Bunny video).
 *
 * Only the stored E2E sessions (e2e/.auth/user-*.json) are used, and only
 * videos whose channelId is one of that user's own channels are deleted, so
 * seeded QA content (qa-admin/qa-moderator/qa-creator/qa-viewer) can never be
 * touched.
 *
 * Used two ways:
 *  - as Playwright globalTeardown (keeps the reusable seed videos, removes
 *    everything else the run created), and
 *  - as a one-off script that wipes everything, seeds included:
 *      E2E_REUSE_USERS_TIMESTAMP=<ts> WEB_APP_URL=... OPENAUTH_URL=... \
 *        npx tsx e2e/cleanup-test-content.ts [--keep-seed] [--dry-run]
 */

import * as fs from 'fs';
import { AUTH_STATE, type AuthUser } from './test-utils/auth-state';
import { listOwnVideos, userApi, SEED_TITLES } from './test-utils/e2e-videos';
import { ensureFreshSession } from './test-utils/fresh-session';
import { runId } from './test-utils/run-users';

const USERS: AuthUser[] = ['single', 'multi', 'none', 'scratch'];
const SEED_TITLE_SET = new Set<string>(Object.values(SEED_TITLES));

export interface CleanupOptions {
  keepSeed: boolean;
  /** Default: the four channel users */
  users?: AuthUser[];
  /**
   * Only delete videos created at least this long ago. The teardown passes a
   * grace period so it never deletes the in-flight disposable videos of other
   * Playwright runs (local or CI) sharing the same E2E users; those runs clean
   * up after themselves.
   */
  minAgeMs?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}

interface TrashItem { id: string; title: string; status: 'deleted' | 'queued' | 'purging' | 'purged' }

/** A channel's trash (GET /api/channels/:id/content/deleted), every page. */
async function listTrash(u: ReturnType<typeof userApi>, channelId: string, log: (message: string) => void): Promise<TrashItem[]> {
  const items: TrashItem[] = [];
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const res = await u.api.get<{ result?: { items?: TrashItem[]; cursor?: string | null } }>(
      `/api/channels/${channelId}/content/deleted?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { token: u.token, channelId, allowStatus: [403, 404, 500, 503] },
    );
    if (res.status !== 200) {
      log(`[cleanup] listing ${channelId}'s trash returned ${res.status}`);
      break;
    }
    items.push(...(res.data.result?.items ?? []));
    cursor = res.data.result?.cursor ?? '';
    if (!cursor) break;
  }
  return items;
}

export async function cleanupTestVideos(opts: CleanupOptions): Promise<number> {
  const log = opts.log ?? (() => undefined);
  let deleted = 0;
  let purged = 0;

  for (const user of opts.users ?? USERS) {
    if (!fs.existsSync(AUTH_STATE[user])) {
      log(`[cleanup] no stored session for ${user}; skipping`);
      continue;
    }
    // A long run outlives the stored access token
    await ensureFreshSession(AUTH_STATE[user]);
    const u = userApi(user);
    if (u.channelIds.length === 0) continue;
    const own = new Set(u.channelIds);
    const videos = (await listOwnVideos(u)).filter((v) => own.has(v.channelId));
    const cutoff = Date.now() - (opts.minAgeMs ?? 0);
    const createdAt = (v: { dateCreated?: string }) => new Date(v.dateCreated || 0).getTime();
    const targets = videos.filter(
      (v) => !(opts.keepSeed && SEED_TITLE_SET.has(v.title)) && createdAt(v as { dateCreated?: string }) <= cutoff,
    );
    log(`[cleanup] ${user}: ${videos.length} owned, ${targets.length} to delete`);
    if (opts.dryRun) continue;

    // bulk-delete is scoped to one channel per request. It only moves a video to
    // the trash (restorable for 30 days, its Bunny video kept), so purge follows.
    const byChannel = new Map<string, string[]>();
    for (const v of targets) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) || []), v.id]);
    for (const [channelId, ids] of byChannel) {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await u.api.post('/api/videos/bulk-delete', { videoIds: batch }, {
          token: u.token,
          channelId,
          allowStatus: [400, 403, 404],
        });
        if (res.status < 300) deleted += batch.length;
        else log(`[cleanup] bulk-delete returned ${res.status} for ${user}/${channelId}`);
      }
    }

    // Delete permanently: everything in these channels' trash, which includes the
    // videos specs deleted themselves through the UI and never show up in the owner
    // search above. The purge (POST /api/videos/bulk-purge, queued for the next
    // cleanup run) removes the record, its media and the Bunny video; without it the
    // trash kept every run video in Bunny for 30 days (QA, 2026-11-11: ~4,000).
    // With keepSeed, only what this pass deleted; the trash can't hold a seed video
    // (seeds are never deleted) but the filter keeps that promise explicit.
    const deletedNow = new Set(targets.map((v) => v.id));
    for (const channelId of own) {
      const trashed = await listTrash(u, channelId, log);
      const ids = trashed.filter((t) => t.status === 'deleted' && (!opts.keepSeed || deletedNow.has(t.id) || !SEED_TITLE_SET.has(t.title))).map((t) => t.id);
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await u.api.post<{ summary?: { succeeded?: number } }>('/api/videos/bulk-purge', { videoIds: batch }, {
          token: u.token,
          channelId,
          allowStatus: [400, 403, 404],
        });
        if (res.status < 300) purged += res.data.summary?.succeeded ?? 0;
        else log(`[cleanup] bulk-purge returned ${res.status} for ${user}/${channelId}`);
      }
    }
  }
  log(`[cleanup] ${deleted} moved to the trash, ${purged} queued for permanent deletion (record, media and Bunny video)`);
  return deleted;
}

const RUN_USERS: AuthUser[] = ['single', 'multi', 'none', 'scratch', 'fresh'];

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * CI run mode (E2E_RUN_ID): the users are this job's own, so everything they
 * own goes. Their videos first (trashed, then purged with their Bunny video),
 * then DELETE /api/privacy/data (the GDPR erase: profile, channels, playlists,
 * posts, history, subscriptions, likes; comments anonymised), repeated while
 * it reports `complete: false`. The workflow's teardown then deletes the
 * accounts on the auth server (scripts/e2e/teardown-run-users.ts). Returns
 * the number of users erased; failures are logged, never thrown.
 */
export async function eraseRunUsers(log: (message: string) => void = () => undefined): Promise<number> {
  if (!runId()) throw new Error('eraseRunUsers only runs in run mode (E2E_RUN_ID)');
  try {
    await withTimeout(cleanupTestVideos({ keepSeed: false, minAgeMs: 0, log, users: RUN_USERS }), 4 * 60 * 1000, 'deleting the run users\' videos');
  } catch (error) {
    log(`[cleanup] ${(error as Error).message}`);
  }
  let erased = 0;
  // Bounded: the workflow's account delete runs after this step and must get its turn
  const deadline = Date.now() + 8 * 60 * 1000; // the CLI also stops at 9 min, the step at 10
  for (const user of RUN_USERS) {
    if (!fs.existsSync(AUTH_STATE[user])) continue;
    if (Date.now() > deadline) {
      log(`[cleanup] out of time before ${user}; the QA cleanup removes what is left`);
      break;
    }
    try {
      await withTimeout(ensureFreshSession(AUTH_STATE[user]), 90_000, `refreshing ${user}'s session`);
      const u = userApi(user);
      let resumeToken: string | undefined;
      for (let round = 0; round < 20; round++) {
        if (Date.now() > deadline) throw new Error('out of time');
        const res = await withTimeout(
          u.api.request<{ complete?: boolean; resumeToken?: string }>('/api/privacy/data', {
            method: 'DELETE',
            token: u.token,
            json: { confirm: 'DELETE', ...(resumeToken ? { resumeToken } : {}) },
            allowStatus: [400, 401, 403, 404, 500],
          }),
          60_000,
          `erasing ${user}'s data`,
        );
        if (res.status >= 300) {
          log(`[cleanup] privacy erase returned ${res.status} for ${user}`);
          break;
        }
        const body = res.data as { complete?: boolean; resumeToken?: string; result?: { complete?: boolean; resumeToken?: string } };
        const result = body?.result ?? body;
        if (result?.complete !== false) {
          erased++;
          break;
        }
        resumeToken = result.resumeToken;
      }
    } catch (error) {
      log(`[cleanup] erasing ${user} failed: ${(error as Error).message}`);
    }
  }
  log(`[cleanup] erased ${erased} run user(s)`);
  return erased;
}

/** Playwright globalTeardown: remove everything the run created, keep seed videos */
export default async function globalTeardown(): Promise<void> {
  // Run mode: the workflow's always() step erases the run users (it also runs
  // when the job is cancelled, which globalTeardown does not)
  if (runId()) return;
  try {
    // 30 minutes covers any test still running in a concurrent run
    await cleanupTestVideos({ keepSeed: true, minAgeMs: 30 * 60 * 1000, log: (m) => console.log(m) });
  } catch (error) {
    // Cleanup must not fail the run
    console.warn('[cleanup] teardown failed', error);
  }
}

if (require.main === module) {
  (async () => {
    const args = new Set(process.argv.slice(2));
    // CI teardown step: erase this run's users from the stored sessions
    if (args.has('--run-users')) {
      // Whatever hangs, the step ends in time for the account delete after it
      await withTimeout(eraseRunUsers((m) => console.log(m)), 9 * 60 * 1000, 'erasing the run users').catch((error: Error) =>
        console.log(`[cleanup] ${error.message}; the QA cleanup removes what is left`),
      );
      // A browser or socket left open by a session refresh must not keep the step alive
      process.exit(0);
    }
    if (!args.has('--skip-auth')) {
      const { default: globalSetup } = await import('./auth.setup');
      await globalSetup({ configFile: '', rootDir: process.cwd() } as Parameters<typeof globalSetup>[0]);
    }
    const count = await cleanupTestVideos({
      keepSeed: args.has('--keep-seed'),
      dryRun: args.has('--dry-run'),
      log: (m) => console.log(m),
    });
    console.log(`[cleanup] deleted ${count} video(s)`);
  })().catch((error) => {
    console.error('[cleanup] failed', error);
    process.exit(1);
  });
}
