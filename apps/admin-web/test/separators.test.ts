/**
 * Separators next to numbers (owner 2026-11-20): «·» (U+00B7) next to Arabic digits reads as an
 * Arabic zero («تدخّل مشرف · ٣ مجموعات» looked like «٣٠ مجموعات»). Every separator in the web and
 * admin interface is « • » (U+2022), as the web's meta lines already are, in both languages.
 * This guard reads the sources and catalogues; comments and the SEO title example are allowed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTranslator } from '../src/i18n/translate';

// Tests run from apps/admin-web
const ROOT = join(process.cwd(), '..', '..');
const DIRS = ['apps/web/src', 'apps/admin-web/src', 'packages/shared-types/src'];
/** The Studio "page title" field's example pattern and its hint (a creator-editable template, not a separator we render) */
/**
 * Text other apps send outside the web and admin pages (push notifications, scholar-site page
 * titles and blocks): their own fix, issue #1674 */
const OUT_OF_SCOPE = ['packages/shared-types/src/review-alerts.ts', 'packages/shared-types/src/site.ts', 'packages/shared-types/src/page-blocks.ts'];
const ALLOWED = [/placeholder="%s · …"/, /titleTemplateHint: .*%s · /];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : files(path);
    return /\.(tsx?|json)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('separators are « • », never «·» (it reads as an Arabic zero next to digits)', () => {
  it('no web or admin source or catalogue renders «·»', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of files(join(ROOT, dir))) {
        if (OUT_OF_SCOPE.includes(relative(ROOT, file))) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (!line.includes('·')) return;
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
    assert.match(line, /١ قيد التحويل • ٣ في الانتظار/);
    assert.doesNotMatch(line, /·/);
    assert.equal(t('errorsPage.originShare' as never, { count: '٣', percent: 50 }), '٣ • ٥٠٪');
  });
});
