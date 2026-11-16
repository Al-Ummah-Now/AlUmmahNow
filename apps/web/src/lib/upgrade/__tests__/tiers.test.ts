/**
 * /upgrade card logic (wiki AUN-TIER-REQUESTS): what each card says, which
 * footer it shows, the form's checks and the API error copy, in en and ar.
 */
import { AR_TRANSLATIONS, EN_TRANSLATIONS, type PublicTier, type TierRequest } from '@al-ummah/shared-types';
import { cardState, requestErrorMessage, tierDescription, tierFeatures, tierName, validateRequestForm } from '../tiers';

const member: PublicTier = {
  id: 'member', name: 'Member', nameAr: 'عضو', description: null, descriptionAr: null, unlimited: false, uploads: false, channels: false,
  maxChannels: 1, captionMinutesMonth: 0, uploadsPerDay: 50, requestable: true,
};
const creator: PublicTier = { ...member, id: 'creator', name: 'Creator', nameAr: 'صانع محتوى', uploads: true, channels: true, maxChannels: 3, uploadsPerDay: 2000, captionMinutesMonth: 120, description: 'For channels', descriptionAr: null };
const unlimited: PublicTier = { ...creator, id: 'unlimited', name: 'Unlimited', nameAr: null, unlimited: true, maxChannels: null, uploadsPerDay: null, requestable: false };
const pending = (tierId: string) => ({ status: 'pending', tierId }) as TierRequest;

describe('tier cards', () => {
  it('lists the same five rows on every card, from the flags, never a price', () => {
    const rows = (tier: PublicTier) => tierFeatures(tier, EN_TRANSLATIONS.upgrade, 'en').map((f) => [f.key, f.included, f.text]);
    expect(rows(member)).toEqual([
      ['watch', true, 'Watch, save, comment and subscribe'],
      ['uploads', false, 'No uploads'],
      ['channels', false, 'No channel creation'],
      ['captions', false, 'No caption minutes'],
    ]);
    expect(rows(creator).map((r) => r[2])).toEqual(['Watch, save, comment and subscribe', 'Upload up to 2,000 videos a day', 'Create up to 3 channels', '120 caption minutes a month']);
    expect(rows(unlimited).map((r) => r[2])).toEqual(['Watch, save, comment and subscribe', 'Upload with no daily limit', 'Create any number of channels', 'Captions with no monthly limit']);
    expect(tierFeatures({ ...creator, maxChannels: 1 }, EN_TRANSLATIONS.upgrade, 'en')[2].text).toBe('Create 1 channel');
    expect(JSON.stringify(rows(creator))).not.toMatch(/\$|price|month\b.*\d+\.\d/i);
  });

  it('speaks Arabic with Arabic digits and the admin\'s Arabic names, falling back to English ones', () => {
    const ar = tierFeatures(creator, AR_TRANSLATIONS.upgrade, 'ar');
    expect(ar[1].text).toBe('رفع حتى ٢٬٠٠٠ مرئي يوميًا');
    expect(ar[2].text).toBe('إنشاء حتى ٣ قنوات');
    expect(tierName(creator, 'ar')).toBe('صانع محتوى');
    expect(tierName(unlimited, 'ar')).toBe('Unlimited');
    expect(tierDescription(creator, 'ar')).toBe('For channels');
    expect(tierDescription(member, 'en')).toBeNull();
  });

  it('picks each card\'s footer: current, requested, request, waiting or sign in', () => {
    const none = { currentTierId: 'member', request: null };
    expect(cardState(member, none, true)).toBe('current');
    expect(cardState(creator, none, true)).toBe('request');
    expect(cardState(unlimited, { currentTierId: 'member', request: null }, true)).toBe('waiting');
    const asked = { currentTierId: 'member', request: pending('creator') };
    expect(cardState(creator, asked, true)).toBe('requested');
    expect(cardState({ ...creator, id: 'pro' }, asked, true)).toBe('waiting', );
    expect(cardState(creator, { currentTierId: 'member', request: { ...pending('creator'), status: 'declined' } }, true)).toBe('request');
    expect(cardState(creator, { currentTierId: null, request: null }, false)).toBe('sign-in');
  });
});

describe('request form', () => {
  const f = EN_TRANSLATIONS.upgrade.form;
  it('checks name and about lengths like the server', () => {
    expect(validateRequestForm({ name: 'Yusuf', about: 'I record the Friday khutbah every week.' }, f)).toEqual({});
    expect(validateRequestForm({ name: ' Y ', about: 'short' }, f)).toEqual({ name: 'Enter your name (2 to 100 characters)', about: 'Write at least 20 characters' });
    expect(validateRequestForm({ name: 'Yusuf', about: 'x'.repeat(1001) }, f).about).toBe('Keep it under 1000 characters');
    expect(validateRequestForm({ name: 'يوسف', about: 'أدير قناة صغيرة لمسجد الحي وأسجّل الخطب.' }, AR_TRANSLATIONS.upgrade.form)).toEqual({});
  });

  it('turns API refusals into the page\'s words', () => {
    const e = EN_TRANSLATIONS.upgrade.errors;
    expect(requestErrorMessage('tier_request_pending', e)).toBe(e.pending);
    expect(requestErrorMessage('tier_already_held', e)).toBe(e.held);
    expect(requestErrorMessage('tier_not_requestable', e)).toBe(e.notRequestable);
    expect(requestErrorMessage('tier_requests_limit', e)).toBe(e.tooMany);
    expect(requestErrorMessage('human_check_required', e)).toBe(e.humanCheck);
    expect(requestErrorMessage('network', e)).toBe(e.failed);
    expect(requestErrorMessage(undefined, AR_TRANSLATIONS.upgrade.errors)).toBe('لم يُرسل طلبك. حاول مرة أخرى.');
  });
});
