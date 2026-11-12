import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, report } from '../run-leftovers.ts';

describe('run leftovers (deployed)', () => {
  it('only QA or stage, only a run id marker', () => {
    assert.equal(parseArgs(['--env', 'qa', '--marker', '123-1']).marker, '123-1');
    assert.throws(() => parseArgs(['--env', 'production', '--marker', '123-1']));
    assert.throws(() => parseArgs(['--env', 'qa', '--marker', "x' OR 1=1"]));
  });
  it('counts accounts, content and tiers; queued purges are reported, not counted', () => {
    const lines = report('123-1', { accounts: ['e2e+123-1-a@e2e.alummahnow.net'], content: [], pendingPurge: [{ kind: 'video', id: 'v1' }], tiers: [] });
    assert.match(lines[0], /: 1 \(\+1 deleted, purge queued\)/);
  });
});
