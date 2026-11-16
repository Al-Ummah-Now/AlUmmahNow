/**
 * The graph against the tree: every tracked file is mapped, the import scan matches the committed
 * edges (no missing, no stale), every E2E spec belongs to exactly one suite, and the graph's own data
 * is consistent. Run: pnpm test:scripts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { adjacency, allEdges, nodeOf, readWorkspacePackage, selectFiles, workspaceEdges } from '../core.ts';
import { drift, driftOfTree } from '../drift.ts';
import { matchGlob } from '../glob.ts';
import { EXTRA_EDGES, NODES, SUITES } from '../graph.ts';
import { resolveRelative, scanReferences, trackedFiles, unitOf, type Reference } from '../import-edges.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const FILES = trackedFiles(ROOT);
const ADJ = adjacency(allEdges(workspaceEdges(readWorkspacePackage(ROOT))));
const NODE_IDS = new Set(NODES.map((n) => n.id));

describe('coverage', () => {
  it('every tracked file maps to the ignore list or a node', () => {
    const unmapped = FILES.filter((f) => nodeOf(f) === undefined);
    assert.deepEqual(unmapped, [], 'add these paths to scripts/ci/select/graph.ts (a node, or IGNORE)');
  });

  it('every node matches at least one tracked file (no dead globs)', () => {
    const used = new Set(FILES.map((f) => nodeOf(f)));
    assert.deepEqual(NODES.filter((n) => !used.has(n.id)).map((n) => n.id), []);
  });

  it('every app and package folder has a whole-unit node', () => {
    const units = new Set(FILES.map(unitOf).filter((u) => /^(apps|packages)\//.test(u)));
    const named = new Set(NODES.map((n) => n.unit).filter(Boolean));
    assert.deepEqual([...units].filter((u) => !named.has(u)).sort(), []);
  });
});

describe('edge drift', () => {
  it('the import scan and the committed graph agree', () => {
    const d = driftOfTree(ROOT);
    assert.deepEqual(d.missing, [], 'add an EXTRA_EDGES entry (or a sub-node) in scripts/ci/select/graph.ts');
    assert.deepEqual(d.stale, [], 'remove EXTRA_EDGES entries nothing in the tree uses any more');
  });

  it('finds the undeclared edges the graph is built on', () => {
    const refs = scanReferences(ROOT, FILES, ['packages/fanous-tokens']);
    const has = (from: string, to: string) => refs.some((r) => r.from === from && r.to === to);
    assert.ok(has('apps/web/src/app/globals.css', 'packages/fanous-tokens/nav/aun-nav.css'));
    assert.ok(has('apps/admin-web/src/app/globals.css', 'apps/web/src/theme/site-themes.css'));
    assert.ok(has('apps/admin-api/wrangler.jsonc', 'apps/cost-monitor/migrations'));
    assert.ok(has('scripts/local-stack/run-teardown.ts', 'packages/shared-types/src/queue.ts'));
    // Inside the split package: the runtime model imports contrast.ts
    assert.ok(has('packages/fanous-tokens/src/themes.ts', 'packages/fanous-tokens/src/contrast.ts'));
  });

  it('reports a missing edge and a stale one', () => {
    const refs: Reference[] = [
      // status would use a scheduler file: scheduler selects nothing, status selects admin and release
      { from: 'apps/status/src/render.ts', to: 'apps/scheduler/src/index.ts', spec: '../../scheduler/src/index.ts', kind: 'path' },
    ];
    const d = drift(refs, ['apps/status/src/render.ts', 'apps/scheduler/src/index.ts'], ADJ);
    assert.equal(d.missing.length, 1);
    assert.match(d.missing[0], /^scheduler → status: apps\/status\/src\/render\.ts uses apps\/scheduler\/src\/index\.ts/);
    assert.equal(d.stale.length, EXTRA_EDGES.length);
  });

  it('a use by a node that selects nothing needs no edge', () => {
    const refs: Reference[] = [{ from: 'apps/api-videos/test/x.spec.ts', to: 'apps/scheduler/src/index.ts', spec: '../../scheduler/src/index.ts', kind: 'path' }];
    assert.deepEqual(drift(refs, ['apps/api-videos/test/x.spec.ts', 'apps/scheduler/src/index.ts'], ADJ).missing, []);
  });

  it('resolves extensions, ESM .js for .ts, index files and folders', () => {
    const files = new Set(['packages/a/src/x.ts', 'packages/a/src/lib/index.ts', 'packages/a/nav/h.js']);
    const folders = new Set(['packages', 'packages/a', 'packages/a/src', 'packages/a/src/lib', 'packages/a/nav']);
    assert.equal(resolveRelative('apps/w/s/f.ts', '../../../packages/a/src/x', files, folders), 'packages/a/src/x.ts');
    assert.equal(resolveRelative('apps/w/s/f.ts', '../../../packages/a/src/x.js', files, folders), 'packages/a/src/x.ts');
    assert.equal(resolveRelative('apps/w/s/f.ts', '../../../packages/a/src/lib', files, folders), 'packages/a/src/lib/index.ts');
    assert.equal(resolveRelative('apps/w/s/f.ts', '../../../packages/a/nav/', files, folders), 'packages/a/nav');
    assert.equal(resolveRelative('apps/w/s/f.ts', '../../../../outside', files, folders), undefined);
  });
});

describe('spec ownership', () => {
  // Specs no selected suite runs: theme visibility, help pictures and production checks have their
  // own workflows, and log-service's spec runs in its unit tests
  const OUTSIDE = new Set(['e2e:other-web-suites', 'unit-tests']);
  const expectedCount = (spec: string) => (OUTSIDE.has(nodeOf(spec) ?? '') ? 0 : 1);
  const specs = FILES.filter((f) => /^apps\/[^/]+\/e2e\/.*\.spec\.ts$/.test(f));

  it('every E2E spec file selects exactly one suite (or none, for suites outside Local E2E and Player E2E)', () => {
    const wrong: string[] = [];
    for (const spec of specs) {
      const p = selectFiles({ files: [spec], adj: ADJ });
      const chosen = Object.keys(p.suites).filter((s) => p.suites[s]);
      const expected = expectedCount(spec);
      if (p.mode !== 'selected' || chosen.length !== expected) wrong.push(`${spec}: ${p.mode} ${chosen.join(',')}`);
    }
    assert.ok(specs.length > 200);
    assert.deepEqual(wrong, []);
  });

  it('every SPEC_PLACEMENT key selects exactly one suite (or none, as above)', async () => {
    const { SPEC_PLACEMENT } = (await import(new URL('../../../../apps/web/e2e/test-utils/placement.ts', import.meta.url).href)) as { SPEC_PLACEMENT: Record<string, unknown> };
    const wrong = Object.keys(SPEC_PLACEMENT).filter((key) => {
      const p = selectFiles({ files: [key], adj: ADJ });
      return p.mode !== 'selected' || Object.values(p.suites).filter(Boolean).length !== expectedCount(key);
    });
    assert.deepEqual(wrong, []);
  });

  it('a placed spec selects the suite its folder runs in', () => {
    const suiteOf = (f: string) => Object.entries(selectFiles({ files: [f], adj: ADJ }).suites).filter(([, v]) => v).map(([k]) => k).join();
    assert.equal(suiteOf('apps/web/e2e/01-homepage.spec.ts'), 'web');
    assert.equal(suiteOf('apps/web/e2e/a11y/pages.spec.ts'), 'web');
    assert.equal(suiteOf('apps/web/e2e/release/player.spec.ts'), 'release');
    assert.equal(suiteOf('apps/web/e2e/player/alignment.spec.ts'), 'player');
    assert.equal(suiteOf('apps/admin-web/e2e/01-auth.spec.ts'), 'admin');
  });
});

describe('graph data', () => {
  it('node ids are unique', () => {
    assert.equal(NODE_IDS.size, NODES.length);
  });

  it('every edge, partOf and suite dependency names a node', () => {
    const bad = [
      ...EXTRA_EDGES.flatMap((e) => [e.from, e.to]),
      ...NODES.flatMap((n) => (n.partOf ? [n.partOf] : [])),
      ...Object.values(SUITES).flatMap((s) => s.dependsOn),
    ].filter((id) => !NODE_IDS.has(id));
    assert.deepEqual(bad, []);
  });

  it('declared workspace deps become edges (shared-types → web, theme-packages → admin-web)', () => {
    const declared = workspaceEdges(readWorkspacePackage(ROOT));
    assert.ok(declared.some((e) => e.from === 'shared-types' && e.to === 'web'));
    assert.ok(declared.some((e) => e.from === 'theme-packages' && e.to === 'admin-web'));
  });

  it('globs: ** spans folders, * stays in one, braces alternate', () => {
    assert.ok(matchGlob('**/*.md', 'README.md'));
    assert.ok(matchGlob('**/*.md', 'docs/a/b.md'));
    assert.ok(!matchGlob('package.json', 'apps/web/package.json'));
    assert.ok(matchGlob('apps/*/package.json', 'apps/web/package.json'));
    assert.ok(!matchGlob('apps/web/e2e/*.spec.ts', 'apps/web/e2e/release/a.spec.ts'));
    assert.ok(matchGlob('apps/web/src/app/*/dev/player/**', 'apps/web/src/app/[locale]/dev/player/page.tsx'));
    assert.ok(matchGlob('apps/{web,status}/wrangler*.{json,jsonc}', 'apps/status/wrangler.qa.jsonc'));
    assert.ok(!matchGlob('apps/{web,status}/wrangler*.{json,jsonc}', 'apps/media/wrangler.jsonc'));
  });
});
