/** #1462: the admin's copy of keep-typed-before-hydration is the videos site's, byte for byte (its tests live there). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('keep-typed-before-hydration matches apps/web', () => {
  assert.equal(read('../src/lib/forms/keep-typed-before-hydration.ts'), read('../../web/src/lib/forms/keep-typed-before-hydration.ts'));
  assert.equal(read('../src/components/forms/KeepTypedBeforeHydration.tsx'), read('../../web/src/components/forms/KeepTypedBeforeHydration.tsx'));
});
