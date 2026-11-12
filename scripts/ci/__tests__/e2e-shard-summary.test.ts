import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, summarise } from '../e2e-shard-summary.ts';

const test = (projectName: string, status: string) => ({ projectName, status, results: [] });
const report = {
  suites: [
    {
      title: 'a.spec.ts',
      file: 'a.spec.ts',
      specs: [{ title: 'top', file: 'a.spec.ts', line: 3, tests: [test('chromium', 'expected'), test('firefox', 'unexpected')] }],
      suites: [
        {
          title: 'Group',
          file: 'a.spec.ts',
          specs: [{ title: 'inner', file: 'a.spec.ts', line: 9, tests: [test('webkit', 'unexpected'), test('Mobile Safari', 'unexpected'), test('chromium', 'flaky')] }],
        },
      ],
    },
    { title: 'b.spec.ts', file: 'b.spec.ts', specs: [{ title: 'skip me', file: 'b.spec.ts', line: 1, tests: [test('chromium', 'skipped')] }] },
  ],
};

describe('e2e-shard-summary', () => {
  it('counts outcomes and groups failures per spec with their projects', () => {
    const s = summarise(report);
    assert.deepEqual({ passed: s.passed, failed: s.failed, flaky: s.flaky, skipped: s.skipped }, { passed: 1, failed: 3, flaky: 1, skipped: 1 });
    assert.deepEqual(
      s.rows.map((r) => [r.file, r.line, r.outcome, r.title, r.projects]),
      [
        ['a.spec.ts', 3, 'failed', 'top', ['firefox']],
        ['a.spec.ts', 9, 'failed', 'Group › inner', ['webkit', 'Mobile Safari']],
        ['a.spec.ts', 9, 'flaky', 'Group › inner', ['chromium']],
      ],
    );
  });

  it('prints one block per spec file', () => {
    const md = markdown(summarise(report));
    assert.match(md, /1 passed, 3 failed, 1 flaky, 1 skipped/);
    assert.match(md, /\*\*a\.spec\.ts\*\*\n- ❌ failed :3 top — firefox\n- ❌ failed :9 Group › inner — webkit, Mobile Safari\n- ⚠️ flaky :9 Group › inner — chromium/);
    assert.doesNotMatch(md, /b\.spec\.ts/);
    assert.match(markdown(summarise({ suites: [] })), /No failed or flaky tests/);
  });
});
