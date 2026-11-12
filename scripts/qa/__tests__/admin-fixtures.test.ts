/**
 * Guard: every admin-web spec takes `test` from the suite's fixtures (apps/admin-web/e2e/support/fixtures.ts),
 * never straight from @playwright/test. The fixtures carry suite-wide rules every test must get: the
 * reports a test filed are cleaned up, and WebKit on the local stack is quarantined (#1020). A spec
 * that imported `test` from @playwright/test ran outside them (17-delivery-live-qoe on WebKit,
 * #987).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const E2E = join(import.meta.dirname, '..', '..', '..', 'apps', 'admin-web', 'e2e');

/** Value imports from @playwright/test that bring in `test` (type-only imports are fine). */
export function importsTestFromPlaywright(source: string): boolean {
  for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/g)) {
    if (m[1]) continue;
    const names = m[2].split(',').map((n) => n.trim()).filter((n) => !n.startsWith('type '));
    if (names.some((n) => n === 'test' || n.startsWith('test as '))) return true;
  }
  return false;
}

describe('admin-web specs use the suite fixtures', () => {
  it('no spec imports test from @playwright/test', () => {
    const offenders = readdirSync(E2E)
      .filter((f) => f.endsWith('.spec.ts'))
      .filter((f) => importsTestFromPlaywright(readFileSync(join(E2E, f), 'utf8')));
    assert.deepEqual(offenders, [], `import { test, expect } from './support/fixtures' instead in: ${offenders.join(', ')}`);
  });

  it('the rule itself: type-only imports and other names pass, test does not', () => {
    assert.equal(importsTestFromPlaywright(`import type { Page } from '@playwright/test';`), false);
    assert.equal(importsTestFromPlaywright(`import { expect, type Page } from '@playwright/test';`), false);
    assert.equal(importsTestFromPlaywright(`import { test, expect } from '@playwright/test';`), true);
    assert.equal(importsTestFromPlaywright(`import { expect, test as base } from "@playwright/test";`), true);
  });
});
