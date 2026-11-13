import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, outcomes } from '../playwright-outcomes.ts';

const report = {
  suites: [{
    title: 'a.spec.ts', file: 'a.spec.ts',
    specs: [
      { title: 'runs', file: 'a.spec.ts', line: 3, tests: [{ projectName: 'chromium', status: 'expected' }] },
      { title: 'quarantined', file: 'a.spec.ts', line: 7, tests: [{ projectName: 'chromium', status: 'skipped', annotations: [{ type: 'fixme', description: 'quarantined: #1 @x' }] }] },
    ],
    suites: [{ title: 'Group', file: 'a.spec.ts', specs: [{ title: 'retried', file: 'a.spec.ts', line: 9, tests: [{ projectName: 'webkit', status: 'flaky' }] }] }],
  }],
};

describe('playwright-outcomes', () => {
  it('lists every test with its status, skipped ones with their reason', () => {
    const list = outcomes(report);
    assert.deepEqual(list.map((o) => `${o.status} ${o.title}`), ['passed runs', 'skipped quarantined', 'flaky Group › retried']);
    assert.equal(list[1]!.reason, 'fixme: quarantined: #1 @x');
    const md = markdown(list, 'Shard 1/5');
    assert.match(md, /1 passed, 0 failed, 1 flaky, 1 skipped/);
    assert.match(md, /\*\*skipped\*\*\n- a\.spec\.ts:7 quarantined \[chromium\] — fixme: quarantined: #1 @x/);
  });
});
