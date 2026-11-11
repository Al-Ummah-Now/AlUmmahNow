import { EN_TRANSLATIONS as en, AR_TRANSLATIONS as ar } from '@al-ummah/shared-types';
import { creatorRefusalMessage, formatWait } from '../friendly-error';

describe('friendly creator-tier refusals (never the server text)', () => {
  it('says when the user can upload again, in English and Arabic', () => {
    expect(creatorRefusalMessage(en, { code: 'upload_limit', retryAfter: 23 * 60 })).toBe("You've reached the upload limit; try again in 23 minutes");
    expect(creatorRefusalMessage(en, { code: 'upload_limit', retryAfter: 30 })).toBe("You've reached the upload limit; try again in 1 minute");
    expect(creatorRefusalMessage(en, { code: 'upload_limit', retryAfter: 5 * 3600 })).toBe("You've reached the upload limit; try again in 5 hours");
    expect(creatorRefusalMessage(ar, { code: 'upload_limit', retryAfter: 23 * 60 })).toBe('بلغت حد الرفع؛ حاول مرة أخرى بعد 23 دقيقة');
    expect(creatorRefusalMessage(en, { code: 'upload_limit' })).toBe("You've reached the upload limit; try again in a moment");
  });

  it('explains uploads by invitation and the channel limit', () => {
    expect(creatorRefusalMessage(en, { code: 'uploads_by_invitation' })).toBe('Uploading is by invitation for now');
    expect(creatorRefusalMessage(ar, { code: 'uploads_by_invitation' })).toBe('الرفع بدعوة فقط حاليًا');
    expect(creatorRefusalMessage(en, { code: 'channel_limit', maxChannels: 3 })).toBe('You can own up to 3 channels');
  });

  it('says a pending deletion of their videos data blocks uploads (#701)', () => {
    expect(creatorRefusalMessage(en, { code: 'videos_account_pending_deletion' })).toBe('Your videos account is scheduled for deletion. Contact support.');
    expect(creatorRefusalMessage(ar, { code: 'videos_account_pending_deletion' })).toBe('حسابك في الفيديوهات مجدول للحذف. تواصل مع الدعم.');
  });

  it('is null for anything else, so callers show their generic message', () => {
    expect(creatorRefusalMessage(en, { code: 'something_else' })).toBeNull();
    expect(creatorRefusalMessage(en, null)).toBeNull();
  });

  it('rounds waits up to minutes, then hours from 90 minutes', () => {
    expect(formatWait(en, 1)).toBe('1 minute');
    expect(formatWait(en, 89 * 60)).toBe('89 minutes');
    expect(formatWait(en, 90 * 60)).toBe('2 hours');
    expect(formatWait(en, 3600 * 24)).toBe('24 hours');
  });
});
