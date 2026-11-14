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
import { cityFromId, matchZones, normalizeSearch, zoneOffset, zoneOptions } from '../src/app/(protected)/review-alerts/timezones';
import { avatarInitial } from '../src/components/search/autocomplete-model';
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

  it('finds time zones by id, city, country and Arabic city, with the UTC offset', () => {
    const zones = timeZones();
    const at = new Date('2026-01-15T12:00:00Z');
    const en = zoneOptions('en', zones, at);
    const ar = zoneOptions('ar', zones, at);
    assert.equal(matchZones(en, 'riyadh')[0]!.id, 'Asia/Riyadh');
    assert.equal(matchZones(en, 'new york')[0]!.id, 'America/New_York');
    assert.equal(matchZones(en, 'Asia/Amman')[0]!.id, 'Asia/Amman');
    assert.equal(matchZones(ar, 'الرياض')[0]!.id, 'Asia/Riyadh');
    assert.equal(matchZones(ar, 'عمان')[0]!.id, 'Asia/Amman', 'without the shadda too');
    assert.equal(matchZones(ar, 'riyadh')[0]!.city, 'الرياض', 'English words still match on the Arabic page');
    assert.equal(zoneOffset('Asia/Riyadh', at).label, 'UTC+3');
    assert.equal(zoneOffset('America/New_York', at).label, 'UTC−5');
    assert.equal(zoneOffset('Asia/Kolkata', at).label, 'UTC+5:30');
    assert.equal(zoneOffset('UTC', at).label, 'UTC');
    assert.equal(cityFromId('America/Argentina/Buenos_Aires'), 'Buenos Aires');
    assert.equal(normalizeSearch('عمّان'), normalizeSearch('عمان'));
    assert.equal(matchZones(en, '').length, zones.length);
  });

  it('takes the first letter of a name for its avatar', () => {
    assert.equal(avatarInitial('sara Haddad'), 'S');
    assert.equal(avatarInitial('  ✨ Lina'), 'L');
    assert.equal(avatarInitial('\u0301émile'), 'É');
    assert.equal(avatarInitial('هناء القاسم'), 'ه\u200D', 'Arabic letters show their initial form');
    assert.equal(avatarInitial('«عمر»'), 'ع\u200D');
    assert.equal(avatarInitial('🙂'), '?');
  });
});
