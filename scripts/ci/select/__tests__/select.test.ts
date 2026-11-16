/**
 * The selector against the real graph and this checkout's package.json files: golden file lists
 * (one per row of the wiki's walk table), the replay of #1521, the placement-table diff, and failing
 * open. Run: pnpm test:scripts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adjacency, allEdges, placementChanges, readWorkspacePackage, selectFiles, workspaceEdges, type Plan } from '../core.ts';
import { PLACEMENT_FILE } from '../graph.ts';
import { annotation, plan, summary, type Git } from '../select.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ADJ = adjacency(allEdges(workspaceEdges(readWorkspacePackage(ROOT))));

function selected(files: string[], placement?: () => { base: string; head: string }): Plan {
  return selectFiles({ files, adj: ADJ, placement });
}

function suites(p: Plan): string {
  if (p.mode === 'all') return 'all';
  return Object.keys(p.suites).filter((s) => p.suites[s]).sort().join(',') || 'none';
}

const PLACEMENT_BASE = [
  'export const SPEC_PLACEMENT: Record<string, SpecPlacement> = {',
  "  'apps/admin-web/e2e/01-auth.spec.ts': { placement: 'local', reason: 'admin sign-in' },",
  "  'apps/web/e2e/01-homepage.spec.ts': { placement: 'local', reason: 'home' },",
  "  'apps/web/e2e/release/player.spec.ts': { placement: 'local', reason: 'plays' },",
  '};',
].join('\n');

describe('golden cases', () => {
  const cases: Array<[string, string[], string]> = [
    ['docs and Markdown only', ['docs/testing/LOCAL-STACK.md', 'apps/web/README.md', 'CLAUDE.md'], 'none'],
    // The player code imports @al-ummah/shared-types, so Player E2E runs too
    ['a shared type', ['packages/shared-types/src/video.ts'], 'admin,player,release,web'],
    ['the queue types the stack teardown imports', ['packages/shared-types/src/queue.ts'], 'all'],
    ['the logger', ['packages/logger/src/index.ts'], 'admin,release,web'],
    ['admin-web only', ['apps/admin-web/src/app/(protected)/costs/page.tsx'], 'admin,release'],
    ['admin-api only', ['apps/admin-api/src/index.ts'], 'admin,release'],
    ['api-videos', ['apps/api-videos/src/index.ts'], 'admin,release,web'],
    ['status', ['apps/status/src/render.ts'], 'admin,release'],
    ['short-links', ['apps/short-links/src/index.ts'], 'release,web'],
    ['web outside the player', ['apps/web/src/app/[locale]/page.tsx'], 'admin,release,web'],
    ['the colour lint (#1521)', ['packages/fanous-tokens/src/color-lint.ts', 'packages/fanous-tokens/test/color-lint.test.ts', 'theme-colors.allowlist.json'], 'none'],
    ['the token generators', ['packages/fanous-tokens/src/generators/web.ts', 'packages/fanous-tokens/src/cli.ts'], 'none'],
    ['the shared header', ['packages/fanous-tokens/nav/header.js'], 'admin,player,release,web'],
    ['the player theme CSS', ['packages/fanous-tokens/generated-player/fawanees.css'], 'admin,player,release,web'],
    ['the token model theme-packages builds from', ['packages/fanous-tokens/src/themes.ts'], 'admin,player,release,web'],
    ['theme-packages', ['packages/theme-packages/src/index.ts'], 'admin,release'],
    ['the VideoPlayer component', ['apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx'], 'admin,player,release,web'],
    ['the player harness page', ['apps/web/src/app/[locale]/dev/player/page.tsx'], 'admin,player,release,web'],
    ['a player unit test', ['apps/web/src/components/VideoPagePlayer/__tests__/ChapterNav.test.tsx'], 'none'],
    ['workers not on the stack', ['apps/scheduler/src/index.ts', 'apps/media/src/edge.ts', 'apps/cost-monitor/src/collect.ts', 'apps/log-service/src/index.ts', 'packages/mcp-log-server/src/index.ts'], 'none'],
    ['cost-monitor migrations (applied through admin-api on the stack)', ['apps/cost-monitor/migrations/0001_init.sql'], 'all'],
    ['unit tests of a stack app', ['apps/api-videos/test/sites.spec.ts', 'apps/admin-web/test/costs.test.ts'], 'none'],
    ['ops scripts', ['scripts/release/release-tag.ts', 'scripts/qa/e2e-leftovers.ts'], 'none'],
    ['a release helper the stack imports', ['scripts/release/jsonc.ts'], 'all'],
    ['the lockfile', ['pnpm-lock.yaml'], 'all'],
    ['a workspace package.json', ['apps/web/package.json'], 'all'],
    ['the Local E2E workflow', ['.github/workflows/local-e2e.yml'], 'all'],
    ['another workflow', ['.github/workflows/seo-crawl.yml'], 'none'],
    ['the local stack', ['scripts/local-stack/stack.ts'], 'all'],
    ['a stack app wrangler config', ['apps/processor/wrangler.jsonc'], 'all'],
    ['a non-stack wrangler config', ['apps/scheduler/wrangler.jsonc'], 'none'],
    ['the selector itself', ['scripts/ci/select/graph.ts'], 'all'],
    ['the locale-format baseline', ['scripts/ci/locale-format-baseline.txt'], 'none'],
    ['the shared E2E harness', ['apps/web/e2e/test-utils/run-users.ts'], 'all'],
    ['a release-suite builder', ['apps/web/e2e/release/builders.ts'], 'all'],
    ['a web spec', ['apps/web/e2e/72-real-sign-in.spec.ts'], 'web'],
    ['a web visual baseline', ['apps/web/e2e/visual/home.spec.ts'], 'web'],
    ['a release spec', ['apps/web/e2e/release/signup-signin.spec.ts'], 'release'],
    ['the release config', ['apps/web/playwright.release.config.ts'], 'release'],
    ['a player spec', ['apps/web/e2e/player/alignment.spec.ts'], 'player'],
    ['an admin spec and its support', ['apps/admin-web/e2e/27-costs.spec.ts', 'apps/admin-web/e2e/support/api.ts'], 'admin'],
    ['theme-visibility specs (their own workflow)', ['apps/web/e2e/themes/contrast.spec.ts'], 'none'],
    ['a new top-level folder', ['tools/new-thing.ts'], 'all'],
    ['a new app', ['apps/newapp/src/index.ts'], 'all'],
  ];
  for (const [name, files, expected] of cases) {
    it(name, () => assert.equal(suites(selected(files)), expected));
  }

  it('records the chain that selected each suite', () => {
    const p = selected(['packages/shared-types/src/video.ts']);
    assert.match(p.why.admin, /^packages\/shared-types\/src\/video\.ts → shared-types → .+ → Local admin suite$/);
    assert.match(p.why.player, /shared-types → web:player → Player E2E/);
  });

  it('sets the build job with the stack suites', () => {
    assert.deepEqual(selected(['apps/admin-web/src/app/layout.tsx']).jobs, { web: false, admin: true, release: true, build: true });
    assert.deepEqual(selected(['apps/web/e2e/player/alignment.spec.ts']).jobs, { web: false, admin: false, release: false, build: false });
    assert.equal(selected(['pnpm-lock.yaml']).jobs.build, true);
  });
});

describe('#1521 replayed', () => {
  const files = readFileSync(new URL('./fixtures/pr-1521-files.txt', import.meta.url), 'utf8').split('\n').filter(Boolean);
  const head = PLACEMENT_BASE.replace(
    "  'apps/web/e2e/01-homepage",
    "  'apps/admin-web/e2e/28-arabic-numerals-hydration.spec.ts': { placement: 'local', reason: 'hydrates' },\n  'apps/web/e2e/01-homepage",
  );

  it('runs the admin and release suites, not the web shards or Player E2E', () => {
    assert.equal(files.length, 86);
    const p = selected(files, () => ({ base: PLACEMENT_BASE, head }));
    assert.equal(p.mode, 'selected');
    assert.equal(suites(p), 'admin,release');
    assert.deepEqual(p.jobs, { web: false, admin: true, release: true, build: true });
  });

  it('the colour-lint file alone selects no E2E suite', () => {
    assert.equal(suites(selected(['packages/fanous-tokens/src/color-lint.ts'])), 'none');
  });
});

describe('placement table', () => {
  it('a changed row selects the suite of its spec', () => {
    const head = PLACEMENT_BASE.replace("reason: 'home'", "reason: 'home page'");
    assert.deepEqual(placementChanges(PLACEMENT_BASE, head), ['apps/web/e2e/01-homepage.spec.ts']);
    assert.equal(suites(selected([PLACEMENT_FILE], () => ({ base: PLACEMENT_BASE, head }))), 'web');
  });

  it('added and removed rows count', () => {
    const head = PLACEMENT_BASE.replace(/\n {2}'apps\/web\/e2e\/release\/player\.spec\.ts'.*/, '');
    assert.deepEqual(placementChanges(PLACEMENT_BASE, head), ['apps/web/e2e/release/player.spec.ts']);
    assert.equal(suites(selected([PLACEMENT_FILE], () => ({ base: PLACEMENT_BASE, head }))), 'release');
  });

  it('a change outside the rows runs everything', () => {
    const head = `/** doc */\n${PLACEMENT_BASE}`;
    assert.equal(placementChanges(PLACEMENT_BASE, head), undefined);
    const p = selected([PLACEMENT_FILE], () => ({ base: PLACEMENT_BASE, head }));
    assert.equal(p.mode, 'all');
    assert.match(p.reason, /outside its rows/);
  });

  it('an unreadable or unparsable table runs everything', () => {
    assert.equal(selected([PLACEMENT_FILE], () => { throw new Error('bad object'); }).mode, 'all');
    assert.equal(selected([PLACEMENT_FILE]).mode, 'all');
    assert.equal(selected([PLACEMENT_FILE], () => ({ base: PLACEMENT_BASE, head: 'garbage' })).mode, 'all');
  });

  it('the real table parses: every SPEC_PLACEMENT key is one row', async () => {
    const { SPEC_PLACEMENT } = (await import(new URL(`../../../../${PLACEMENT_FILE}`, import.meta.url).href)) as { SPEC_PLACEMENT: Record<string, unknown> };
    const text = readFileSync(new URL(`../../../../${PLACEMENT_FILE}`, import.meta.url), 'utf8');
    const withoutRows = text.split('\n').filter((l) => !/^\s*'[^']+':\s*\{.*\},?\s*$/.test(l)).join('\n');
    assert.deepEqual(placementChanges(withoutRows, text), Object.keys(SPEC_PLACEMENT).sort());
    assert.deepEqual(placementChanges(text, text), []);
  });
});

describe('plan() fails open', () => {
  const okGit: Git = (args) => {
    if (args[0] === 'merge-base') return 'base\n';
    if (args[0] === 'diff') return 'apps/admin-web/src/app/layout.tsx\0';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  it('selects on a pull request', () => {
    const p = plan({ event: 'pull_request', base: 'a', head: 'b', labels: [], root: ROOT }, okGit);
    assert.equal(suites(p), 'admin,release');
  });

  it('runs all on push, schedule, dispatch and release calls', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch', 'workflow_call', '']) {
      assert.equal(plan({ event, base: 'a', head: 'b', labels: [], root: ROOT }, okGit).mode, 'all', event);
    }
  });

  it('runs all with the ci:full label', () => {
    const p = plan({ event: 'pull_request', base: 'a', head: 'b', labels: ['bug', 'ci:full'], root: ROOT }, okGit);
    assert.equal(p.mode, 'all');
    assert.match(p.reason, /ci:full/);
  });

  it('runs all on a git error', () => {
    const p = plan({ event: 'pull_request', base: 'a', head: 'b', labels: [], root: ROOT }, () => { throw new Error('fatal: bad revision'); });
    assert.equal(p.mode, 'all');
    assert.match(p.reason, /selector error: fatal: bad revision/);
  });

  it('runs all without a base or head', () => {
    assert.equal(plan({ event: 'pull_request', labels: [], root: ROOT }, okGit).mode, 'all');
  });

  it('runs all on an unmapped file', () => {
    const git: Git = (args) => (args[0] === 'merge-base' ? 'base' : 'apps/web/src/a.ts\0brand-new/x.ts\0');
    const p = plan({ event: 'pull_request', base: 'a', head: 'b', labels: [], root: ROOT }, git);
    assert.equal(p.mode, 'all');
    assert.match(p.reason, /unmapped file: brand-new\/x\.ts/);
  });

  it('still selects when the workspace package.json files cannot be read', () => {
    const p = plan({ event: 'pull_request', base: 'a', head: 'b', labels: [], root: '/nonexistent/root' }, okGit);
    // No package.json: no declared edges, admin-web still selects its own suites
    assert.equal(p.mode, 'selected');
  });
});

describe('output', () => {
  it('summary lists every suite with run or skip', () => {
    const text = summary(selected(['apps/admin-web/src/app/layout.tsx']), 'shadow');
    assert.match(text, /shadow: every suite still runs/);
    assert.match(text, /\| Local web suite \| \*\*skip\*\* \|/);
    assert.match(text, /\| Local admin suite \| run \| apps\/admin-web\/src\/app\/layout\.tsx → admin-web → Local admin suite \|/);
    assert.match(text, /\| Player E2E \| \*\*skip\*\* \|/);
  });

  it('annotation is one escaped line of compact JSON', () => {
    const line = annotation(selected(['apps/admin-web/src/app/layout.tsx']));
    assert.match(line, /^::notice title=test-selection-plan::\{/);
    assert.ok(!line.includes('\n'));
    const json = JSON.parse(line.replace('::notice title=test-selection-plan::', '').replace(/%25/g, '%'));
    assert.deepEqual(json, { m: 'selected', s: ['admin', 'release'], r: 'selected: admin, release' });
  });
});
