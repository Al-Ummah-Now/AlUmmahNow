/**
 * Owner decision 2026-11-15 (#1488): Arabic admin pages use Eastern Arabic (Hindi) numerals ٠–٩
 * for every number, date, time, duration, percentage and amount of money; English uses Arabic
 * numerals 0–9. Formatting goes through locale-format (@al-ummah/shared-types) with the numbering
 * system pinned, so the server and every browser agree.
 *
 * Guards: no message writes a number of its own (they use placeholders), the page formatters and
 * rendered components put no 0–9 in Arabic text, and Arabic money never shows «US$».
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { DEFAULT_CREATOR_TIER, captionUsageFrom, fillTemplate, type CreatorTier } from '@al-ummah/shared-types';
import { createTranslator, formatDate, formatHour, formatNumber } from '../src/i18n/translate';
import { I18nProvider } from '../src/i18n/I18nProvider';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { deliveryFormats } from '../src/app/(protected)/delivery/format';
import { opsFormats } from '../src/app/(protected)/operations/model';
import { visitFormats } from '../src/lib/site-visits';
import { metricFormatter } from '../src/lib/live-streaming';
import { formatPasskeyDeadline } from '../src/lib/passkeys';
import { CaptionGrantControls } from '../src/components/creators/CaptionGrantControls';
import { TierEditor } from '../src/components/creators/TierEditor';

(globalThis as unknown as { React: unknown }).React = React;

const ASCII_DIGIT = /[0-9]/;

/**
 * Text that keeps its digits as written: product and code names (R2, D1, SHA-256, MP4, WCAG 2.2,
 * .woff2, 1080p), version strings (1.4.0), JSON examples and typed example values.
 */
const KEEP = [
  /\{[^{}]*"[^{}]*\}/g, // JSON examples such as {"limit": 5}
  /"[^"]*"/g, // quoted code values such as "1080p" or "variant-b"
  /\b\d+(?:\.\d+){2,}\b/g, // versions: 1.4.0
  /[A-Za-z][\w.-]*\d[\w.-]*/g, // R2, D1, SHA-256, H264, docs/specs paths
  /\.\w*\d\w*/g, // .woff2
  /§\d+/g,
  /(?:or|أو|,) 3\b/g, // "a value like 3" in the app-config hints (typed values)
];

function stripKept(text: string): string {
  return KEEP.reduce((s, re) => s.replace(re, ''), text);
}

function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ');
}

function render(element: React.ReactElement, locale: 'en' | 'ar'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'dark' }, element) as never);
}

describe('messages write numbers as formatter placeholders', () => {
  for (const [lang, messages] of [['ar', ar], ['en', en]] as const) {
    it(`no ${lang} message has a hard-coded number`, () => {
      const offenders = leaves(messages)
        .map(([key, text]) => [key, stripKept(text.replace(/\{[#$][^}]*\}/g, '').replace(/\{\w+\}/g, ''))] as const)
        .filter(([, text]) => /[0-9٠-٩]/.test(text))
        .map(([key, text]) => `${key}: ${text}`);
      assert.deepEqual(offenders, [], 'use {#n} or a named placeholder');
    });
  }

  it('Arabic messages filled by the translator have no 0–9 outside product names and code', () => {
    const tAr = createTranslator('ar');
    for (const [key] of leaves(ar)) {
      const text = stripKept(tAr(key as never, { count: 3, n: 3, days: 7, minutes: 5, value: 12.5, total: 1200, progress: 42 }));
      assert.doesNotMatch(text.replace(/\{\w+\}/g, ''), ASCII_DIGIT, key);
    }
  });

  it('English keeps Arabic numerals 0–9', () => {
    const tEn = createTranslator('en');
    assert.equal(tEn('mediaDelivery.period7' as never), 'Last 7 days');
    assert.equal(fillTemplate('en', en.contact.deleteConfirm).includes('30 days'), true);
    assert.equal(createTranslator('ar')('mediaDelivery.period7' as never), 'آخر ٧ أيام');
  });
});

describe('page formatters', () => {
  const at = '2026-11-15T14:05:00Z';

  it('Delivery, Backfill, Operations, Site visits, Live and the translator write ٠–٩ in Arabic', () => {
    const d = deliveryFormats('ar');
    const o = opsFormats('ar');
    const v = visitFormats('ar');
    const outputs = [
      d.integer(1234), d.decimal(3.25), d.seconds(2.5), d.duration(3725), d.percent(0.42), d.kbps(2500), d.hours(12.5), d.gb(3.2),
      d.usd(12.69), d.usd(0.5), d.usd(0.0042), d.time('2026-11-15T22:00'), d.day('2026-11-15'),
      o.count(5400), o.bytes(2_500_000), o.ms(12.5), o.us(450), o.gbs(12), o.percent(0.0123), o.usd(12.69), o.day('2026-11-15'), o.month('2026-11'), o.time(at),
      v.count(42), v.axis(4200), v.percent(0.25), v.day('2026-11-15'), v.date('2026-11-15'),
      metricFormatter('ar', 'usd')(12.69), metricFormatter('ar', 'ms')(1500), metricFormatter('ar', 'ratio')(0.5), metricFormatter('ar', 'usdSmall')(0.0123),
      formatNumber(1234, 'ar'), formatDate(at, 'ar', true), formatHour('2026-11-11T14', 'ar'), formatPasskeyDeadline(1_763_000_000, 'ar'),
    ];
    for (const text of outputs) {
      assert.doesNotMatch(text, ASCII_DIGIT, `0–9 in «${text}»`);
      assert.doesNotMatch(text, /US\$|\$US|\$/, `dollar sign in Arabic «${text}»`);
    }
    assert.equal(d.usd(12.69), '١٣ دولار أمريكي');
    // No-break spaces: «دولار أمريكي» never wraps away from its amount (AUDIT-2 #27)
    assert.equal(o.usd(12.69), '١٢٫٦٩\u00a0دولار\u00a0أمريكي');
  });

  it('English is unchanged', () => {
    const d = deliveryFormats('en');
    assert.equal(d.usd(12.69), '$13');
    assert.equal(opsFormats('en').usd(12.69), '$12.69');
    assert.equal(d.integer(1234), '1,234');
    assert.equal(formatNumber(1234, 'en'), '1,234');
  });
});

describe('rendered Arabic components', () => {
  const noop = async () => ({ ok: true as const, data: null });
  const usage = captionUsageFrom({ period: '2026-11', unlimited: false, via: 'tier', tierMinutes: 120, monthGranted: 0, monthUsed: 120, packsRemaining: 0, overdraft: 7, held: 17 });
  const ledger = [
    { id: 'job-1:settle', holdId: 'job-1', kind: 'settle' as const, minutes: -2, balanceAfter: -7, period: '2026-11', createdAt: '2026-11-14T11:00:00.000Z' },
    { id: 'job-1:start', holdId: 'job-1', kind: 'start' as const, minutes: 17, balanceAfter: -5, period: '2026-11', createdAt: '2026-11-14T10:00:00.000Z' },
  ];

  it('caption minutes (counts, signed balances, dates) have no 0–9', () => {
    const html = render(React.createElement(CaptionGrantControls as never, { userId: 'u1', usage, grants: [], ledger, canManage: false, grant: noop, revoke: noop } as never), 'ar');
    assert.doesNotMatch(stripKept(visibleText(html)), ASCII_DIGIT);
    assert.match(visibleText(html), /١٧/);
  });

  it('the tiers page (users per tier, bounds) has no 0–9', () => {
    const tier: CreatorTier = { ...DEFAULT_CREATOR_TIER, id: 'creator', name: 'Creator', unlimited: false, perHour: 300, perDay: 2000, maxConcurrent: 20, maxChannels: 3, captionMinutesMonth: 120, audioTracksPerVideo: 2, live: true, liveHoursMonth: 20, liveMaxConcurrent: 1, liveMaxStreamMinutes: 240, updatedAt: null, updatedBy: null };
    const save = async () => ({ ok: true as const, data: null });
    const html = render(React.createElement(TierEditor as never, { tiers: [tier], counts: { creator: 12 }, canManage: true, actions: { save, remove: save } } as never), 'ar');
    assert.match(visibleText(html), /١٢ مستخدم/);
    assert.doesNotMatch(stripKept(visibleText(html)), ASCII_DIGIT);
  });
});
