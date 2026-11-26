/**
 * Separators next to numbers (owner 2026-11-20): «·» (U+00B7) next to Arabic digits reads as an
 * Arabic zero («تدخّل مشرف · ٣ مجموعات» looked like «٣٠ مجموعات»). Every separator in the web and
 * admin interface is « • » (U+2022) in English. In Arabic even « • » next to digits read as a zero
 * («عام • ١٢ ألف» as «١٢٠ ألف»), so Arabic separates values with the Arabic comma «، » (owner
 * 2026-11-21, with O38; Android #51 and Desktop #69 do the same): shared `metaSeparator` /
 * `joinMeta`, the admin `common.sep` message and `<Sep />`, the web `<MetaSep />`.
 * This guard reads the sources and catalogues; comments and the SEO title example are allowed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTranslator } from '../src/i18n/translate';
import ar from '../src/i18n/messages/ar';

// Tests run from apps/admin-web
const ROOT = join(process.cwd(), '..', '..');
const DIRS = ['apps/web/src', 'apps/admin-web/src', 'packages/shared-types/src'];
/** The Studio "page title" field's example pattern and its hint (a creator-editable template, not a separator we render) */
const ALLOWED = [/placeholder="%s · …"/, /titleTemplateHint: .*%s · /];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : files(path);
    return /\.(tsx?|json)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Arabic never separates values with a dot (it reads as an Arabic zero next to digits)', () => {
  // English may use « • » or « · » (metaSeparator(lang, '·')); a dot in a line with Arabic text is the bug
  it('no web or admin source or catalogue puts «·» in Arabic text', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of files(join(ROOT, dir))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (!line.includes('·') || !/[\u0600-\u06FF]/.test(line)) return;
          const code = line.trim();
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
          if (ALLOWED.some((re) => re.test(line))) return;
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${code.slice(0, 120)}`);
        });
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('Arabic admin lines keep digits apart from the separator', () => {
    const t = createTranslator('ar');
    const line = t('mediaDelivery.liveSummary' as never, { running: 1, waiting: 3, min: 2, max: 4 });
    assert.match(line, /١ قيد التحويل، ٣ في الانتظار/);
    assert.doesNotMatch(line, /[·•]/);
    assert.equal(t('errorsPage.originShare' as never, { count: '٣', percent: 50 }), '٣، ٥٠٪');
    assert.equal(t('common.sep' as never), '، ');
    assert.equal(createTranslator('en')('common.sep' as never), ' • ');
  });

  it('no Arabic admin message separates values with a dot', () => {
    const strings = (node: unknown, at: string, out: Array<[string, string]>): Array<[string, string]> => {
      if (typeof node === 'string') out.push([at, node]);
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, at ? `${at}.${k}` : k, out);
      return out;
    };
    // «••••1234» is a masked card or key, not a separator
    const offenders = strings(ar, '', []).filter(([, text]) => /[·•]/.test(text.replace(/•{2,}/g, ''))).map(([key, text]) => `${key}: ${text}`);
    assert.deepEqual(offenders, []);
  });
});
