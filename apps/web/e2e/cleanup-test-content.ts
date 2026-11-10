/**
 * Deletes videos owned by the E2E test users (test-single/multi/none/scratch-*).
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

const USERS: AuthUser[] = ['single', 'multi', 'none', 'scratch'];
const SEED_TITLE_SET = new Set<string>(Object.values(SEED_TITLES));

export interface CleanupOptions {
  keepSeed: boolean;
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

export async function cleanupTestVideos(opts: CleanupOptions): Promise<number> {
  const log = opts.log ?? (() => undefined);
  let deleted = 0;

  for (const user of USERS) {
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
    if (opts.dryRun || targets.length === 0) continue;

    // bulk-delete is scoped to one channel per request
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
  }
  return deleted;
}

/** Playwright globalTeardown: remove everything the run created, keep seed videos */
export default async function globalTeardown(): Promise<void> {
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
