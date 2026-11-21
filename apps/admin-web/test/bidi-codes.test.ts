/**
 * Latin codes whose punctuation is part of the code («ERR-», «re_», «https://», «Alt+↑») flip in
 * right-to-left text: the trailing «-» of «رمز ERR-» was drawn on the code's left, so the
 * placeholder read «…رمز -ERR» (re-audit 3 of #1665). Each such code in the Arabic catalogue sits in
 * a left-to-right isolate (U+2066 … U+2069), which also works inside a placeholder, where no markup
 * can go.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ar from '../src/i18n/messages/ar';

const LRI = '⁦';
const PDI = '⁩';
/** Codes that end or start in a neutral mark, so the mark would move to the code's other side */
const CODES = ['ERR-', 're_', 'mer_', 'https://', 'Alt+↑', 'Alt+↓'];

function strings(node: unknown, at: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([at, node]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, at ? `${at}.${k}` : k, out);
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Latin codes in Arabic admin strings keep their order', () => {
  const all = strings(ar, '', []);

  it('the Errors search placeholder isolates ERR-', () => {
    const hit = all.find(([key, text]) => key.endsWith('searchPlaceholder') && text.includes('ERR-'));
    assert.ok(hit, 'the Errors search placeholder');
    assert.equal(hit[1], `الرسالة أو رمز ${LRI}ERR-${PDI}`);
  });

  for (const code of CODES) {
    it(`every «${code}» is inside an LTR isolate`, () => {
      const uses = all.filter(([, text]) => text.includes(code));
      assert.ok(uses.length > 0, `«${code}» is used in the Arabic catalogue`);
      // A bare use: the code not directly inside LRI … PDI (a URL that merely starts with https:// is fine)
      const bare = new RegExp(`(?<!${LRI})${escape(code)}(?!${PDI})`);
      const offenders = uses.filter(([, text]) => bare.test(text.replace(new RegExp(`https://[^\\s${PDI}]+`, 'g'), (m) => (m === 'https://' ? m : 'URL'))));
      assert.deepEqual(offenders.map(([key]) => key), []);
    });
  }
});
