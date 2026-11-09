import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareToAllowlist, countViolations } from '../src/color-lint.ts';

test('counts hex, colour functions and palette utilities', () => {
  assert.equal(countViolations('color: #ffa037;'), 1);
  assert.equal(countViolations('background: rgb(1 2 3); color: oklch(0.2 0 0);'), 2);
  assert.equal(countViolations('className="bg-gray-800 text-white dark:border-red-500"'), 3);
  assert.equal(countViolations('className="bg-[#123456]"'), 1);
});

test('ignores tokens, anchors, entities and comments', () => {
  assert.equal(countViolations('color: var(--fanous-color-primary); rgb(var(--x));'), 0);
  assert.equal(countViolations('className="bg-fanous-primary text-primary-foreground"'), 0);
  assert.equal(countViolations('href="#top" &#128274; href="/a#abc"'), 0);
  assert.equal(countViolations('// was #ffffff'), 0);
});

test('new colours fail, and a file that improved must lower its count', () => {
  assert.match(compareToAllowlist({ 'a.tsx': 1 }, {})[0], /a\.tsx: 1 hard-coded colours, allowed 0/);
  assert.match(compareToAllowlist({ 'a.tsx': 3 }, { 'a.tsx': 2 })[0], /allowed 2/);
  assert.match(compareToAllowlist({ 'a.tsx': 1 }, { 'a.tsx': 2 })[0], /--update/);
  assert.match(compareToAllowlist({}, { 'a.tsx': 2 })[0], /--update/);
  assert.deepEqual(compareToAllowlist({ 'a.tsx': 2 }, { 'a.tsx': 2 }), []);
});
