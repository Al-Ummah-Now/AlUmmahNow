/**
 * #1666: a number before a noun agrees with it in the admin too. Arabic follows the CLDR plural
 * category of the count («مستخدم واحد», «مستخدمان», «٣ مستخدمين», «١١ مستخدمًا», «١٠٠ مستخدم»),
 * English has "1 user" / "2 users". Every message that puts a count before a noun carries an ICU
 * plural select (filled by the shared fillTemplate through t()); the guard checks each of them and
 * the tables pin the exact wording of the most seen ones.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const KEYS = [
  'palette.count',
  'moderation.totalCount',
  'categorySuggestions.attempts',
  'categorySuggestions.usageLine',
  'review.statsQueue',
  'ai.totalCount',
  'ai.usageToday',
  'translations.showing',
  'processing.resolutions',
  'processing.reconcilerLast',
  'legacyProfiles.summary',
  'legacyProfiles.unmatched',
  'legacyProfiles.ambiguous',
  'legacyProfiles.confirm',
  'legacyProfiles.result',
  'themeBuilder.errors',
  'themeBuilder.warnings',
  'themeBuilder.brandDrives',
  'themeBuilder.linkBrand',
  'authRequests.needsAttention',
  'staleUploads.sweepSummary',
  'staleUploads.sweepErrors',
  'staleUploads.scanned',
  'staleUploads.queuedDelete',
  'staleUploads.queuedRetry',
  'captionMinutes.packsLine',
  'captionMinutes.remainingLine',
  'captionMinutes.grantMonth',
  'captionMinutes.grantUntilUsed',
  'creators.noticeNeedsTier',
  'creators.effectChannels',
  'creators.hitsWeek',
  'creators.effectLive',
  'creators.effectLiveOne',
  'creators.tierSaveBody',
  'creators.tierInUseCount',
  'creators.tierInvitesCount',
  'autocomplete.count',
  'jobs.navBadge',
  'invites.daysLeft',
  'errorsPage.totalCount',
  'errorsPage.navBadge',
  'errorsPage.sparkline',
  'errorsPage.openItems',
  'abusePage.subtitle',
  'transcodeTroubleshoot.logsHoursOption',
  'costs.thresholds.plans.free',
  'costs.thresholds.plans.pro',
  'costs.thresholds.plans.scale',
  'mediaDelivery.scaleVolume',
  'mediaDelivery.liveStart',
  'mediaBackfill.estCeiling',
  'mediaBackfill.basisMeasured',
  'mediaBackfill.settingsInvalid',
  'mediaBackfill.retireConfirmBody',
  'mediaProviders.healthReasonProbes',
  'mediaProviders.healthReasonFallbacks',
  'deleted.daysLeft',
  'deleted.retrying',
  'trash.daysLeft',
  'socialPosting.activityTitle',
  'socialPosting.activityNone',
  'auditLog.count',
  'emailTemplates.testLimited',
];
/** English keeps a unit abbreviation here ("{n} h", "{minutes} min"), so it has no plural form. */
const EN_UNIT_ONLY = new Set(['review.statsQueue', 'transcodeTroubleshoot.logsHoursOption', 'mediaDelivery.scaleVolume', 'mediaBackfill.settingsInvalid']);
const EXACT = [1, 2, 3, 10, 11, 100];

const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/[\u200e\u200f\u061c]/g, '');
const at = (tree: unknown, path: string): string => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree) as string;
const pluralVars = (template: string) => [...template.matchAll(/\{(\w+), plural,/g)].map((m) => m[1]);
const tAr = createTranslator('ar');
const tEn = createTranslator('en');

function wording(lang: 'ar' | 'en', key: string, n: number): string {
  const template = at(lang === 'ar' ? ar : en, key);
  const params: Record<string, string | number> = {};
  for (const name of pluralVars(template)) params[name] = n;
  const t = lang === 'ar' ? tAr : tEn;
  return sp(t(key as never, params)).replace(/[0-9٠-٩٬\u202f,]+/g, '#');
}

describe('#1666: every admin count agrees with its noun', () => {
  for (const key of KEYS) {
    it(key, () => {
      assert.ok(pluralVars(at(ar, key)).length > 0, `ar ${key} has no plural select`);
      const [one, two, few, many] = [1, 2, 3, 11].map((n) => wording('ar', key, n));
      assert.equal(new Set([one, two, few]).size, 3, `ar ${key}: one/two/few should differ: ${one} | ${two} | ${few}`);
      assert.notEqual(few, many, `ar ${key}: 3 and 11 should differ: ${few}`);
      if (!EN_UNIT_ONLY.has(key)) {
        assert.ok(pluralVars(at(en, key)).length > 0, `en ${key} has no plural select`);
        assert.notEqual(wording('en', key, 1), wording('en', key, 2), `en ${key}: 1 and 2 should differ`);
      }
    });
  }
});

describe('#1666: exact admin wording, 1 2 3 10 11 100', () => {
  const arOf = (key: string, name = 'count') => EXACT.map((n) => sp(tAr(key as never, { [name]: n })));
  const enOf = (key: string, name = 'count') => EXACT.map((n) => tEn(key as never, { [name]: n }));

  it('results and reports', () => {
    assert.deepEqual(arOf('palette.count'), ['نتيجة واحدة', 'نتيجتان', '٣ نتائج', '١٠ نتائج', '١١ نتيجة', '١٠٠ نتيجة']);
    assert.deepEqual(enOf('palette.count'), ['1 result', '2 results', '3 results', '10 results', '11 results', '100 results']);
    assert.deepEqual(arOf('moderation.totalCount'), ['بلاغ واحد', 'بلاغان', '٣ بلاغات', '١٠ بلاغات', '١١ بلاغًا', '١٠٠ بلاغ']);
  });

  it('users on a tier', () => {
    assert.deepEqual(arOf('creators.tierInUseCount'), [
      'مستخدم واحد على هذه الفئة. انقله أولًا.', 'مستخدمان على هذه الفئة. انقلهما أولًا.', '٣ مستخدمين على هذه الفئة. انقلهم أولًا.',
      '١٠ مستخدمين على هذه الفئة. انقلهم أولًا.', '١١ مستخدمًا على هذه الفئة. انقلهم أولًا.', '١٠٠ مستخدم على هذه الفئة. انقلهم أولًا.',
    ]);
    assert.equal(tEn('creators.tierInUseCount' as never, { count: 1 }), '1 user is on this tier. Move them first.');
    assert.equal(tEn('creators.tierInUseCount' as never, { count: 2 }), '2 users are on this tier. Move them first.');
  });

  it('minutes and days', () => {
    assert.deepEqual(arOf('captionMinutes.remainingLine'), ['المتاح الآن دقيقة واحدة.', 'المتاح الآن دقيقتان.', 'المتاح الآن ٣ دقائق.', 'المتاح الآن ١٠ دقائق.', 'المتاح الآن ١١ دقيقة.', 'المتاح الآن ١٠٠ دقيقة.']);
    assert.deepEqual(arOf('trash.daysLeft'), ['بعد يوم واحد', 'بعد يومين', 'بعد ٣ أيام', 'بعد ١٠ أيام', 'بعد ١١ يومًا', 'بعد ١٠٠ يوم']);
    assert.deepEqual(enOf('trash.daysLeft'), ['In 1 day', 'In 2 days', 'In 3 days', 'In 10 days', 'In 11 days', 'In 100 days']);
    assert.deepEqual(arOf('socialPosting.activityTitle', 'days'), ['آخر يوم واحد', 'آخر يومين', 'آخر ٣ أيام', 'آخر ١٠ أيام', 'آخر ١١ يومًا', 'آخر ١٠٠ يوم']);
  });

  it('errors page counts and repeats', () => {
    assert.deepEqual(arOf('errorsPage.openItems'), ['عنصر مفتوح واحد', 'عنصران مفتوحان', '٣ عناصر مفتوحة', '١٠ عناصر مفتوحة', '١١ عنصرًا مفتوحًا', '١٠٠ عنصر مفتوح']);
    assert.equal(sp(tAr('errorsPage.sparkline' as never, { count: 2 })), 'مرتان في آخر ١٤ يوماً');
    assert.equal(tEn('errorsPage.sparkline' as never, { count: 1 }), '1 occurrence in the last 14 days');
    assert.deepEqual(arOf('deleted.retrying'), [
      'فشل الحذف النهائي مرة واحدة؛ تجري إعادة المحاولة', 'فشل الحذف النهائي مرتين؛ تجري إعادة المحاولة', 'فشل الحذف النهائي ٣ مرات؛ تجري إعادة المحاولة',
      'فشل الحذف النهائي ١٠ مرات؛ تجري إعادة المحاولة', 'فشل الحذف النهائي ١١ مرة؛ تجري إعادة المحاولة', 'فشل الحذف النهائي ١٠٠ مرة؛ تجري إعادة المحاولة',
    ]);
  });

  it('already formatted numbers still pick the form', () => {
    assert.equal(sp(tAr('palette.count' as never, { count: '١٬٢٣٤' })), '١٬٢٣٤ نتيجة');
    assert.equal(sp(tAr('palette.count' as never, { count: '٣' })), '٣ نتائج');
    assert.equal(tEn('palette.count' as never, { count: '1' }), '1 result');
  });
});
