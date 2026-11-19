/**
 * The admin date field (#1598): what it shows and what it reads. The browser's own date input
 * painted "yyyy/mm/dd" and 0–9 on Arabic pages; the field's text is now the admin's own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDateInput, parseDateInput, toAsciiDigits } from '../src/components/DateField';

describe('admin date field', () => {
  it('shows the day in the admin language digits: 2026-11-18 / ٢٠٢٦/١١/١٨', () => {
    assert.equal(formatDateInput('2026-11-18', 'en'), '2026-11-18');
    assert.equal(formatDateInput('2026-11-18', 'ar'), '٢٠٢٦/١١/١٨');
    assert.equal(formatDateInput('2026-01-05', 'ar'), '٢٠٢٦/٠١/٠٥');
    assert.equal(formatDateInput('', 'ar'), '');
    assert.equal(formatDateInput('not a day', 'en'), '');
  });

  it('reads either digit set and the common orders', () => {
    for (const typed of ['2026-11-18', '٢٠٢٦/١١/١٨', '2026/11/18', '18/11/2026', '١٨-١١-٢٠٢٦', '20261118', '۲۰۲۶/۱۱/۱۸', ' 2026 11 18 ']) {
      assert.equal(parseDateInput(typed), '2026-11-18', typed);
    }
    assert.equal(toAsciiDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  });

  it('empty is a cleared field; a day that does not exist is refused', () => {
    assert.equal(parseDateInput('   '), '');
    for (const bad of ['2026-02-30', '2026-13-01', '18/11/26', 'yesterday', '2026-11']) assert.equal(parseDateInput(bad), null, bad);
  });

  it('every admin date filter uses the shared field (no bare type="date" left)', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
    });
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const bare = walk(root).filter((f) => !f.endsWith('DateField.tsx') && /type="date"/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(bare, []);
  });
});
