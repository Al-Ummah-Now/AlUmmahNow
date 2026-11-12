/**
 * Guard: test sets seed their own data (owner rule 2026-11-12).
 *
 * A spec creates what it needs in its own setup and removes it afterwards
 * (apps/web/e2e/release/builders.ts: createUser, createChannel, createVideo, createPlaylist,
 * createPost, createComment, useOwnData). It never depends on:
 * - the global QA seed's content or accounts (seed titles, qa-*@ addresses, seed-config),
 * - theme-demo videos, hard-coded video ids (E2E_PLAYBACK_VIDEO_ID, 443418c1, UUIDs in URLs),
 * - "the newest public video" (findPlayableVideo, findLandscapeVideo, limit=1 on a shared list),
 * - leftovers from other runs.
 * The global seed keeps only what cannot be made per test: admin/role bootstrap and the
 * creator-tier definitions.
 *
 * Files that still break the rule are listed in ALLOWED with their batch; the list only shrinks.
 * Moving a spec onto the builders means deleting its line here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const DIRS = ['apps/web/e2e', 'apps/admin-web/e2e'];
/** The seed itself, the local-only harnesses with their own mock data, and this rule's builders. */
const EXEMPT = [/\/e2e\/seed\//, /\/e2e\/themes\/(mock-server|harness)/, /\/e2e\/release\/builders\.ts$/];

export const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'seed title', pattern: /QA (Lecture|Nasheed)\b|FIXTURE_TITLES/ },
  { name: 'seed lookup', pattern: /\b(fixtureVideo|findSeedVideo|ensureSeedVideos|qaLecture|findQaLecturesChannel|QA_LECTURES_CHANNEL_NAME)\b|\bseeded\(\)/ },
  { name: 'seed account', pattern: /\bqa-(superadmin|admin|moderator|creator|viewer|sso[\w-]*)@|QA_SEED_PASSWORD|SEED_ACCOUNTS|SEED_CHANNELS|seed\/seed-config/ },
  { name: 'hard-coded video id', pattern: /E2E_PLAYBACK_VIDEO_ID|443418c1|\/(v|embed\/v|watch|videos)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[?&]v=[0-9a-f]{8}-[0-9a-f]{4}/i },
  { name: 'theme demo', pattern: /theme-demo|THEME_DEMO/ },
  { name: 'newest public video', pattern: /\b(findPlayableVideo|findLandscapeVideo)\b|[?&]limit=1\b/ },
];

/**
 * Files that break the rule today, and the batch that moves them (placement.ts; table: scripts/e2e/placement-doc.ts).
 * Only ever remove lines.
 */
export const ALLOWED: Record<string, string> = {
  'apps/admin-web/e2e/04-moderation-queue.spec.ts': 'admin-web batch',
  'apps/admin-web/e2e/14-channel-transfer.spec.ts': 'admin-web batch',
  'apps/admin-web/e2e/15-invites.spec.ts': 'admin-web batch',
  'apps/admin-web/e2e/support/env.ts': 'admin-web batch',
  'apps/web/e2e/player/end-screen.spec.ts': 'web batch 2',
};

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return files(rel);
    return /\.(ts|mjs|js)$/.test(name) ? [rel] : [];
  });
}

export function violations(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

describe('specs seed their own data', () => {
  const all = DIRS.flatMap(files).filter((f) => !EXEMPT.some((re) => re.test(f)));
  const found = new Map(all.map((f) => [f, violations(readFileSync(join(ROOT, f), 'utf8'))] as const).filter(([, v]) => v.length > 0));

  it('no spec or helper depends on the global seed, demo videos, hard-coded ids or "the newest video"', () => {
    const offenders = [...found].filter(([f]) => !(f in ALLOWED)).map(([f, v]) => `${f}: ${v.join(', ')}`);
    assert.deepEqual(offenders, [], 'create the data in the spec (apps/web/e2e/release/builders.ts) instead');
  });

  it('the allowlist only lists files that still need it (remove a line once its file is moved)', () => {
    const stale = Object.keys(ALLOWED).filter((f) => !found.has(f));
    assert.deepEqual(stale, [], 'remove these from ALLOWED in scripts/qa/__tests__/own-data.test.ts');
  });

  it('recognises each forbidden kind', () => {
    assert.deepEqual(violations("findSeedVideo('QA Lecture 1 — Introduction to Tafsir')"), ['seed title', 'seed lookup']);
    assert.deepEqual(violations('qa-creator@e2e.alummahnow.net'), ['seed account']);
    assert.deepEqual(violations('`/embed/v/443418c1-0000-4000-8000-000000000000`'), ['hard-coded video id']);
    assert.deepEqual(violations('await findPlayableVideo(8)'), ['newest public video']);
    assert.deepEqual(violations('const data = useOwnData(test)'), []);
    void relative;
  });
});
