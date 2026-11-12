/**
 * Guard: every E2E spec file has a placement (local stack or deployed QA/stage) with a reason,
 * and docs/testing/E2E-PLACEMENT.md matches apps/web/e2e/test-utils/placement.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SPEC_PLACEMENT } from '../../../apps/web/e2e/test-utils/placement.ts';
import { DOC_PATH, renderPlacementDoc } from '../../e2e/placement-doc.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SPEC = /\.spec\.ts$|\/release-prod\/[^/]+\.check\.ts$/;

function specFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(join(ROOT, path)).isDirectory()) return specFiles(path);
    return SPEC.test(path) ? [relative('.', path)] : [];
  });
}

const DEPLOYED_CATEGORY = /^(sso|bunny|media|pipeline|shared-env): \S/;

describe('E2E placement', () => {
  const files = [...specFiles('apps/web/e2e'), ...specFiles('apps/admin-web/e2e')].sort();

  it('lists every spec file', () => {
    const missing = files.filter((f) => !(f in SPEC_PLACEMENT));
    assert.deepEqual(missing, [], 'add these to apps/web/e2e/test-utils/placement.ts (local or deployed, with a reason)');
  });

  it('lists no spec that does not exist', () => {
    const stale = Object.keys(SPEC_PLACEMENT).filter((f) => !files.includes(f));
    assert.deepEqual(stale, [], 'remove these from apps/web/e2e/test-utils/placement.ts');
  });

  it('gives every spec a reason, and every deployed spec its category', () => {
    for (const [file, { placement, reason }] of Object.entries(SPEC_PLACEMENT)) {
      assert.ok(reason.trim().length > 0, `${file}: no reason`);
      if (placement === 'deployed') assert.match(reason, DEPLOYED_CATEGORY, `${file}: a deployed reason starts with its category`);
    }
  });

  it('marks @load files', () => {
    for (const file of files) {
      const hasLoad = /@load\b/.test(readFileSync(join(ROOT, file), 'utf8'));
      assert.equal(Boolean(SPEC_PLACEMENT[file]?.load), hasLoad, `${file}: load flag must match its @load tests`);
    }
  });

  it('docs/testing/E2E-PLACEMENT.md is up to date', () => {
    assert.equal(readFileSync(DOC_PATH, 'utf8'), renderPlacementDoc(),
      'run: node --experimental-strip-types --no-warnings scripts/e2e/placement-doc.ts --write');
  });
});
