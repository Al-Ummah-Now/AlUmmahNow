import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQafQuote, writeQafQuote } from '../src/qaf.ts';

test('encodes long space runs in passages and labels in linear time', () => {
  const spaces = ' '.repeat(150_000);
  const text = `  أَوَّلُ النَّصِّ${spaces}آخِرُهُ\n مع سطر ثانٍ  `;
  const label = `المؤلف${spaces}الكتاب`;
  const url = 'https://qaf.ai/passages/d9335f69-e54b-59ae-a78c-50db734b8d50';
  const start = performance.now();
  const stored = writeQafQuote(text, label, url);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1000, `encoding took ${elapsed.toFixed(0)} ms`);
  assert.deepEqual(parseQafQuote(stored), { text, label, url });
  assert.deepEqual(parseQafQuote(writeQafQuote(spaces, 'الكتاب', url))?.text, spaces);
});
