import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJobJson } from '../container/request.mjs';

test('container commands require a bounded JSON object', async () => {
  const read = (...parts: string[]) => readJobJson(Readable.from(parts.map((part) => Buffer.from(part))));
  assert.deepEqual(await read('{"jobId":', '"test-job"}'), { jobId: 'test-job' });
  for (const invalid of ['', '{', 'null', '[]', '123', JSON.stringify({ text: 'x'.repeat(256 * 1024) })]) {
    assert.equal(await read(invalid), null);
  }
});
