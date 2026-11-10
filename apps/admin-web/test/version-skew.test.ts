import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSkewRecovery, holdReload, isVersionSkewError, type SkewState } from '../src/lib/version-skew/recovery';

const INCIDENT =
  'Server Action "78646d3443f3ead05cf55e694bd687a28c5d43ae66" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action';

describe('admin version-skew recovery', () => {
  it('detects the deploy errors and nothing else', () => {
    assert.equal(isVersionSkewError(new Error(INCIDENT)), true);
    const chunk = new Error('Loading chunk 9 failed.');
    chunk.name = 'ChunkLoadError';
    assert.equal(isVersionSkewError(chunk), true);
    assert.equal(isVersionSkewError(new Error('Forbidden')), false);
    assert.equal(isVersionSkewError(undefined), false);
  });

  it('reports, shows the notice, reloads; waits while held', () => {
    const states: SkewState[] = [];
    const timers: (() => void)[] = [];
    let reloads = 0;
    let reports = 0;
    const release = holdReload();
    const recovery = createSkewRecovery({
      reload: () => reloads++,
      report: () => reports++,
      setState: (s) => states.push(s),
      storage: null,
      schedule: (fn) => timers.push(fn),
    });
    assert.equal(recovery.handle(new Error(INCIDENT), 'test'), true);
    assert.equal(reports, 1);
    assert.deepEqual(states, ['waiting-for-uploads']);
    release();
    assert.deepEqual(states, ['waiting-for-uploads', 'reloading']);
    timers.splice(0).forEach((fn) => fn());
    assert.equal(reloads, 1);
  });

  for (const file of ['recovery.ts', 'skew-host.ts']) {
    it(`${file} stays identical to the web copy (one behaviour for both apps)`, () => {
      const strip = (s: string) => s.split('\n').filter((l) => !l.includes(`${file} is`)).join('\n');
      const admin = readFileSync(join(__dirname, '../src/lib/version-skew', file), 'utf8');
      const web = readFileSync(join(__dirname, '../../web/src/lib/version-skew', file), 'utf8');
      assert.equal(strip(admin), strip(web));
    });
  }

  it('worker.ts is identical to the web one', () => {
    assert.equal(readFileSync(join(__dirname, '../worker.ts'), 'utf8'), readFileSync(join(__dirname, '../../web/worker.ts'), 'utf8'));
  });
});
