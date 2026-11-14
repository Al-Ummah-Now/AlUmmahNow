/** Review alerts screen: rota editing helpers (the server validates again). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEW_ALERT_SETTINGS, validateReviewAlertSettings } from '@al-ummah/shared-types';
import {
  addOwner,
  addReviewer,
  canSave,
  crossesMidnight,
  formatSeconds,
  removeOwner,
  removeReviewer,
  timeZones,
  toMinutes,
  toSeconds,
  toggleDay,
  updateReviewer,
} from '../src/app/(protected)/review-alerts/model';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

describe('review alerts model', () => {
  it('adds a reviewer once with a weekday shift, edits and removes them', () => {
    let s = addReviewer(DEFAULT_REVIEW_ALERT_SETTINGS, 'u1', 'Asia/Riyadh');
    s = addReviewer(s, 'u1', 'UTC');
    assert.equal(s.rota.length, 1);
    assert.deepEqual(s.rota[0], { userId: 'u1', senior: false, timeZone: 'Asia/Riyadh', shifts: [{ days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' }] });
    s = updateReviewer(s, 'u1', { senior: true });
    assert.equal(s.rota[0]!.senior, true);
    assert.ok(validateReviewAlertSettings(s).ok, 'what the screen builds passes the server check');
    assert.deepEqual(removeReviewer(s, 'u1').rota, []);
  });

  it('owners are a set', () => {
    const s = addOwner(addOwner(DEFAULT_REVIEW_ALERT_SETTINGS, 'o'), 'o');
    assert.deepEqual(s.owners, ['o']);
    assert.deepEqual(removeOwner(s, 'o').owners, []);
  });

  it('minutes ↔ seconds, days, midnight and save rules', () => {
    assert.equal(toMinutes(120), 2);
    assert.equal(toSeconds(2.5), 150);
    assert.deepEqual(toggleDay({ days: [1, 3], start: '09:00', end: '10:00' }, 2).days, [1, 2, 3]);
    assert.deepEqual(toggleDay({ days: [1, 3], start: '09:00', end: '10:00' }, 3).days, [1]);
    assert.equal(crossesMidnight({ days: [1], start: '22:00', end: '06:00' }), true);
    assert.equal(crossesMidnight({ days: [1], start: '22:00', end: '24:00' }), false);
    assert.equal(canSave(DEFAULT_REVIEW_ALERT_SETTINGS), true);
    assert.equal(canSave({ ...DEFAULT_REVIEW_ALERT_SETTINGS, escalateSeniorsAfterSeconds: 120 }), false);
    const noDays = updateReviewer(addReviewer(DEFAULT_REVIEW_ALERT_SETTINGS, 'u'), 'u', { shifts: [{ days: [], start: '09:00', end: '10:00' }] });
    assert.equal(canSave(noDays), false);
    assert.equal(formatSeconds(null, { s: (n) => `${n} s` }), '—');
    assert.equal(formatSeconds(45, { s: (n) => `${n} s` }), '45 s');
    assert.equal(formatSeconds(110, { s: (n) => `${n} s` }), '1:50');
    assert.equal(formatSeconds(150, { s: (n) => `${n} s` }), '2:30');
    assert.ok(timeZones().includes('UTC'));
    assert.equal(timeZones('Mars/Base')[0], 'Mars/Base');
  });

  it('en and ar both name the seven days and use «مرئي»', () => {
    assert.equal(en.reviewAlerts.dayNames.split(',').length, 7);
    assert.equal(ar.reviewAlerts.dayNames.split(',').length, 7);
    assert.ok(!JSON.stringify(ar.reviewAlerts).includes('فيديو'));
  });
});
