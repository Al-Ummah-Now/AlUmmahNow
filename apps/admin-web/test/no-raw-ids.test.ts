/**
 * Owner rule (#1609): the admin never asks for a raw id. Every pick of a channel, user, video or post
 * is a live search picker (Autocomplete, by name, opening with content). These guards fail on a
 * visible input named like an id, or copy telling the admin to paste one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/i18n/messages/en';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
  });
const root = fileURLToPath(new URL('../src', import.meta.url));

describe('no raw id inputs in the admin (#1609)', () => {
  it('no visible <input> takes an entity id (channelId, userId, videoId, postId, ownerId…)', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<(?:input|textarea)\b[^>]*>/gs)) {
        const tag = m[0];
        if (/type="hidden"/.test(tag)) continue;
        if (/name="(channel|user|video|post|owner|playlist|comment|account|creator|staff|profile)Ids?"/.test(tag) || /data-testid="[^"]*-(channel|user|video|post|owner)-id"/.test(tag)) {
          offenders.push(`${file.slice(root.length + 1)}: ${tag.slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('no message tells the admin to copy or paste an id', () => {
    const texts: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (typeof node === 'string') texts.push(`${path}: ${node}`);
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(en, '');
    assert.deepEqual(texts.filter((t) => /\bpaste\b[^.]{0,40}\bids?\b|\bcopy it from the [a-z]+ page\b/i.test(t)), []);
  });
});
