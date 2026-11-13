/**
 * Pre-publication review in Studio (wiki AUN-VIDEO-REVIEW, VR6/VR10): the row's review line and
 * the actions a held or turned-down video offers.
 */
import { etaMinutes, reviewLine } from '../ReviewStatus';
import { rowActions } from '@/lib/studio/videos';
import { STUDIO_EN, STUDIO_AR, studioVideoStatus } from '@al-ummah/shared-types';

const en = STUDIO_EN.videos.review;
const ar = STUDIO_AR.videos.review;

describe('review line', () => {
  it('checking: "usually within N minutes" from the review ETA (VR6, admin-editable)', () => {
    expect(etaMinutes({ since: '2026-11-13T12:00:00.000Z', etaAt: '2026-11-13T12:05:00.000Z' })).toBe(5);
    expect(reviewLine({ status: 'checking', since: '2026-11-13T12:00:00.000Z', etaAt: '2026-11-13T12:07:00.000Z' }, null, en)).toBe('In review · usually within 7 minutes');
    expect(reviewLine({ status: 'checking', since: '2026-11-13T12:00:00.000Z', etaAt: '2026-11-13T12:05:00.000Z' }, null, ar)).toContain('5');
  });
  it('held: "a reviewer will check it" with the live queue time when known', () => {
    expect(reviewLine({ status: 'in_review', since: 'x' }, 12, en)).toBe('A reviewer will check it · about 12 min');
    expect(reviewLine({ status: 'in_review', since: 'x' }, null, en)).toBe('A reviewer will check it');
  });
  it('rejected: the reason in the viewer language; appealed: a different reviewer', () => {
    expect(reviewLine({ status: 'rejected', since: 'x', reasonCode: 'spam_scam' }, null, en)).toBe('Not approved: spam or a scam');
    expect(reviewLine({ status: 'rejected', since: 'x', reasonCode: 'spam_scam' }, null, ar)).toContain('احتيال');
    expect(reviewLine({ status: 'appealed', since: 'x' }, null, en)).toContain('different reviewer');
    expect(reviewLine({ status: 'approved', since: 'x' }, null, en)).toBeNull();
  });
});

describe('studio status and row actions', () => {
  it('checking, held and appealed are In review; rejected is Not approved; processing comes first', () => {
    expect(studioVideoStatus({ uploadStatus: 'ready', review: { status: 'checking' } })).toBe('in_review');
    expect(studioVideoStatus({ uploadStatus: 'ready', review: { status: 'appealed' } })).toBe('in_review');
    expect(studioVideoStatus({ uploadStatus: 'ready', review: { status: 'rejected' } })).toBe('not_approved');
    expect(studioVideoStatus({ uploadStatus: 'processing', review: { status: 'checking' } })).toBe('processing');
    expect(studioVideoStatus({ uploadStatus: 'ready', review: { status: 'approved' } })).toBe('published');
  });
  it('a turned-down video can be edited, checked again or appealed once (VR10)', () => {
    expect(rowActions('not_approved', 'owner')).toEqual(['edit', 'resubmit', 'appeal', 'delete']);
    expect(rowActions('not_approved', 'owner', false, null, true)).toEqual(['edit', 'resubmit', 'delete']);
    expect(rowActions('in_review', 'owner')).toEqual(['edit', 'delete']);
  });
});
