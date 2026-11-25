/**
 * One scrim behind every dialog (#1992): the shared --aun-scrim, dark in both modes. A scrim made of the
 * foreground turned pale in dark mode, one of the background pale in light mode.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');
const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(path.join(SRC, f), 'utf8');

describe('dialog scrim', () => {
  it('native dialogs have the shared scrim, from one rule', () => {
    assert.match(read('app/globals.css'), /\ndialog::backdrop \{\s*background: var\(--aun-scrim\);\s*\}/);
    assert.ok(files.length > 100);
    assert.deepEqual(files.filter((f) => /\bbackdrop:bg-/.test(read(f))), [], 'no dialog sets its own');
  });

  it('hand-made overlays use it too', () => {
    const overlays = files.flatMap((f) => [...read(f).matchAll(/className="([^"]*\bfixed inset-0\b[^"]*)"/g)].map((m) => [f, m[1]] as const)).filter(([, c]) => /(^|\s)bg-/.test(c));
    assert.ok(overlays.length >= 4);
    assert.deepEqual(overlays.filter(([, c]) => !c.includes('bg-[var(--aun-scrim)]')), []);
  });

  it('the shared scrim is dark in both modes', () => {
    const css = readFileSync(path.resolve(SRC, '../../../packages/fanous-tokens/surfaces/aun-surfaces.css'), 'utf8');
    for (const mode of ['light', 'dark']) {
      const m = new RegExp(`--aun-scrim-${mode}: rgb\\((\\d+) (\\d+) (\\d+) / (0\\.\\d+)\\)`).exec(css);
      assert.ok(m && m.slice(1, 4).every((v) => Number(v) < 40) && Number(m[4]) >= 0.4, mode);
    }
  });
});
