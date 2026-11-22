/**
 * The admin's English copy uses typographic apostrophes and quotes (’ “ ”), never straight ones (' ").
 * Scans only the string values of messages/en.ts, so keys and code are never looked at. A value that
 * shows JSON the admin types is listed in CODE_SAMPLES: there the straight quote is the right glyph.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';

/** Key paths whose value quotes JSON the admin types ("1080p", {"limit": 5}). */
const CODE_SAMPLES = new Set<string>([
  'appConfig.valueHint.flags',
  'appConfig.valueHint.config',
  'appConfig.problems.valueJson',
]);

function straightQuotes(tree: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      if (/['"]/.test(node) && !CODE_SAMPLES.has(path)) found.push(`${path}: ${node}`);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(tree, '');
  return found;
}

describe('admin English copy uses typographic quotes', () => {
  it('has no straight apostrophe or quote (use ’ and “ ”)', () => {
    assert.deepEqual(straightQuotes(en), []);
  });

  it('still lists only JSON samples as exceptions', () => {
    for (const path of CODE_SAMPLES) {
      const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], en);
      assert.equal(typeof value, 'string', `${path} is gone: drop it from CODE_SAMPLES`);
      assert.match(value as string, /"/, `${path} has no straight quote any more: drop it from CODE_SAMPLES`);
    }
  });

  it('flags a straight apostrophe and quote', () => {
    assert.deepEqual(straightQuotes({ a: { b: "Don't", c: 'Say "hi"', d: 'Don’t say “hi”' } }), ["a.b: Don't", 'a.c: Say "hi"']);
  });
});
