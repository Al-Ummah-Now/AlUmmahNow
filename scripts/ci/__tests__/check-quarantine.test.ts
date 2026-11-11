import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../check-quarantine.ts';

describe('check-quarantine', () => {
  it('passes a fixme with an issue and an owner', () => {
    assert.deepEqual(violations('a.spec.ts', "test.fixme(true, 'quarantined: #812 @meywd: Bunny encode stalls');"), []);
    assert.deepEqual(violations('a.spec.ts', "// quarantined: #812 @meywd\ntest.fixme('flow', async () => {});"), []);
  });

  it('fails a fixme without one', () => {
    const v = violations('a.spec.ts', "test('ok', () => {});\ntest.fixme('flaky thing', async () => {});");
    assert.equal(v.length, 1);
    assert.equal(v[0].line, 2);
    assert.equal(violations('a.spec.ts', "test.describe.fixme('x', () => {}); // #812").length, 1, 'an issue alone is not enough');
    assert.equal(violations('a.spec.ts', "test.fixme(true, 'quarantined: @meywd');").length, 1, 'an owner alone is not enough');
  });

  it('ignores conditional skips', () => {
    assert.deepEqual(violations('a.spec.ts', "test.skip(!secret, 'TEST_PROMOTE_SECRET is not set');"), []);
  });
});
