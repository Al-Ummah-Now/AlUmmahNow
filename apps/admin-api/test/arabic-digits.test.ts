/**
 * Arabic emails write every number, date and amount in Eastern Arabic (Hindi) numerals ٠–٩
 * through locale-format; English keeps Arabic numerals 0–9 (owner decision 2026-11-15,
 * #1488/#1496). URLs and product codes (D1, R2) stay as written.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderCostEmail } from '../src/lib/cost-alert-mail';
import { renderWarningEmail } from '../src/lib/warning-mail';
import { renderConfirmEmail as renderNewsletterConfirm } from '../src/lib/newsletter';
import { renderConfirmEmail as renderStatusConfirm } from '../src/lib/status-notify';
import { formatEmailDate } from '../src/lib/email/layout';

/** The email's readable text with URLs and code-like names taken out. */
const prose = (text: string) => text.replace(/https?:\/\/\S+/g, '').replace(/\b(D1|R2|KV)\b/g, '');
const noAsciiDigits = (label: string, text: string) => assert.doesNotMatch(prose(text), /[0-9]/, `${label}: 0–9 in «${prose(text).match(/.{0,30}[0-9].{0,30}/)?.[0]}»`);

const digest = {
  type: 'digest' as const,
  week: '2026-11-16',
  mtd: 120.5,
  cap: 400,
  projected: 1310.25,
  lastWeek: 50,
  weekBefore: 40,
  products: [{ product: 'bunny', mtd: 60 }, { product: 'd1', mtd: 12.69 }],
  envs: { production: 80, qa: 10, stage: 0, account: 30 },
  movers: [{ label: 'videos-qa', env: 'qa', change: -4.5 }],
  openAlerts: 12,
};

describe('Arabic emails use ٠–٩', () => {
  it('cost alerts and the digest: money as «… دولار أمريكي», percentages, months and counts', () => {
    const budget = renderCostEmail({ to: 'a@example.com', locale: 'ar', payload: { type: 'budget', month: '2026-11', level: 0.8, mtd: 320, cap: 400, projected: 420 } });
    noAsciiDigits('budget subject', budget.subject);
    noAsciiDigits('budget text', budget.text);
    assert.match(budget.subject, /٨٠٪/);
    assert.match(budget.text, /٣٢٠٫٠٠ دولار أمريكي/);
    assert.match(budget.text, /نوفمبر ٢٠٢٦/);

    const d = renderCostEmail({ to: 'a@example.com', locale: 'ar', payload: digest, adminUrl: 'https://admin.example.com' });
    noAsciiDigits('digest subject', d.subject);
    noAsciiDigits('digest text', d.text);
    assert.match(d.text, /١٢٫٦٩ دولار أمريكي/);
    assert.match(d.text, /آخر ٧ أيام/);
    assert.match(d.text, /١٢\b|١٢$/m);
    assert.doesNotMatch(d.text + d.html, /US\$|\$US/);
    assert.match(d.subject, /١٦ نوفمبر ٢٠٢٦/);

    const spike = renderCostEmail({ to: 'a@example.com', locale: 'ar', payload: { type: 'spike', env: 'qa', resource: true, name: 'videos-qa', day: '2026-11-14', cost: 9.5, baseline: 1.25 } as never });
    noAsciiDigits('spike text', spike.text);
  });

  it('warning mail count, newsletter and status confirmations', () => {
    const warning = renderWarningEmail({ to: 'a@example.com', name: 'Ali', locale: 'ar', reasonCode: 'spam', count: 3, origin: 'https://videos.example.com' });
    noAsciiDigits('warning', warning.text);
    assert.match(warning.text, /٣/);

    const news = renderNewsletterConfirm({ to: 'a@example.com', locale: 'ar', token: 't0k3n', site: 'https://www.example.com' });
    noAsciiDigits('newsletter', news.text);
    assert.match(news.text, /[٠-٩] أيام/);

    const status = renderStatusConfirm({ to: 'a@example.com', locale: 'ar', token: 'abc123', base: 'https://status.example.com' });
    noAsciiDigits('status confirm', status.text);
    assert.match(status.text, /بعد ٧ أيام/);

    noAsciiDigits('email date', formatEmailDate('2026-11-15T14:05:00Z', 'ar', true).replace('UTC', ''));
  });
});

describe('English emails keep 0–9', () => {
  it('money, percentages and day counts read as before', () => {
    const budget = renderCostEmail({ to: 'a@example.com', locale: 'en', payload: { type: 'budget', month: '2026-11', level: 0.8, mtd: 320, cap: 400, projected: 420 } });
    assert.equal(budget.subject, 'Costs: 80% of the monthly budget used');
    assert.match(budget.text, /\$320\.00/);
    assert.match(budget.text, /2026-11/);
    const d = renderCostEmail({ to: 'a@example.com', locale: 'en', payload: digest });
    assert.match(d.text, /Last 7 days/);
    assert.match(d.text, /The 7 days before/);
    assert.match(d.text, /Biggest changes over the last 7 days/);
    assert.match(d.text, /−\$4\.50/);
    assert.match(renderNewsletterConfirm({ to: 'a@example.com', locale: 'en', token: 't', site: 'https://w.example.com' }).text, /works for 7 days/);
    assert.match(renderStatusConfirm({ to: 'a@example.com', locale: 'en', token: 't', base: 'https://s.example.com' }).text, /after 7 days/);
    assert.equal(formatEmailDate('2026-11-15T00:00:00Z', 'en'), '15 November 2026');
  });
});
