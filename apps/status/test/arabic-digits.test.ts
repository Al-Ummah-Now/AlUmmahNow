/**
 * The Arabic status page writes dates, uptimes and day counts in Eastern Arabic (Hindi) numerals
 * ٠–٩ through locale-format; English keeps Arabic numerals 0–9 (owner decision 2026-11-15,
 * #1488/#1496).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDay, formatPercent, formatTime, t, type MessageKey } from '../src/i18n';
import { renderSentPage, renderStatusPage } from '../src/render';
import type { StatusSummary } from '../src/model';

const NOW = '2026-11-15T14:05:00Z';
const days = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10));

const summary: StatusSummary = {
  environment: 'production',
  generatedAt: NOW,
  overall: 'degraded',
  lastCheckedAt: NOW,
  components: [
    { id: 'videos', state: 'degraded', checked: 'operational', since: NOW, checkedAt: NOW, uptime90: '99.95', days: days.map((day, i) => ({ day, level: i % 7 ? 'operational' : 'degraded', uptime: i % 7 ? '100.00' : '97.50' })) as never },
  ],
  active: [
    { id: 'i1', kind: 'incident', title_en: 'Slow videos', title_ar: 'مرئيات بطيئة', status: 'investigating', impact: 'degraded', components: ['videos'], starts_at: NOW, ends_at: null, created_at: NOW, updated_at: NOW, updates: [{ status: 'investigating', body_en: 'Looking', body_ar: 'نبحث', created_at: NOW }] } as never,
  ],
  upcoming: [
    { id: 'm1', kind: 'maintenance', title_en: 'Upgrade', title_ar: 'ترقية', status: 'scheduled', impact: 'maintenance', components: ['videos'], starts_at: '2026-11-20T02:00:00Z', ends_at: '2026-11-20T03:30:00Z', created_at: NOW, updated_at: NOW, updates: [] } as never,
  ],
  history: [],
};

/** What a reader sees: the page's text, without markup, styles, scripts and attributes. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

const opts = { path: '', assetVersion: 'v', environment: 'production' };

describe('status page digits', () => {
  it('every Arabic message and formatted value has ٠–٩ and no 0–9', () => {
    for (const key of ['uptimeTitle', 'daysAgo', 'daysAgo30', 'historyNone', 'sentBody', 'sentSpam', 'expiredBody'] as MessageKey[]) {
      const text = t('ar', key);
      assert.doesNotMatch(text, /[0-9]/, `${key}: «${text}»`);
      assert.match(text, /[٠-٩]/, key);
    }
    assert.equal(t('ar', 'uptimeTitle'), 'نسبة التشغيل خلال آخر ٩٠ يومًا');
    for (const text of [formatTime('ar', NOW), formatDay('ar', '2026-11-15'), formatPercent('ar', '99.95'), t('ar', 'uptimeValue', { value: formatPercent('ar', '99.95') })]) {
      assert.doesNotMatch(text, /[0-9]/, text);
    }
    assert.match(formatPercent('ar', '99.95'), /٩٩٫٩٥٪/);
  });

  it('the rendered Arabic page shows no 0–9; English is unchanged', () => {
    const ar = visibleText(renderStatusPage(summary, { locale: 'ar', ...opts }) + renderSentPage({ locale: 'ar', ...opts }));
    const stray = ar.match(/.{0,30}[0-9].{0,30}/);
    assert.equal(stray, null, `0–9 on the Arabic page: «${stray?.[0]}»`);
    const en = visibleText(renderStatusPage(summary, { locale: 'en', ...opts }));
    assert.match(en, /Uptime over the last 90 days/);
    assert.match(en, /99\.95% uptime/);
    assert.match(en, /15 Nov 2026, 14:05 UTC/);
    assert.match(t('en', 'sentBody'), /works for 7 days/);
  });
});
