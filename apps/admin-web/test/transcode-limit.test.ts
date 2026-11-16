/**
 * Concurrent transcodes range (Video providers → Cloudflare R2 settings): the fields' rules (1 ≤ min ≤ max ≤ ceiling, whole numbers, Eastern Arabic (Hindi)
 * numerals, no-op saves), en/ar copy for every key it and Delivery's live figure use, and the roles
 * (moderators see Delivery's live figures, admins change the setting).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRangeInput, R2_SETTINGS_ID } from '../src/app/(protected)/media-providers/limit-form';
import { canManageMedia, canReadMedia } from '../src/lib/roles';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

describe('the concurrent transcodes range fields', () => {
  const cur = { min: 4, max: 4 };
  it('takes whole numbers with 1 ≤ min ≤ max ≤ ceiling', () => {
    assert.deepEqual(checkRangeInput('2', '6', 10, cur), { ok: true, value: { min: 2, max: 6 } });
    assert.deepEqual(checkRangeInput(' 1 ', '10', 10, cur), { ok: true, value: { min: 1, max: 10 } });
    assert.deepEqual(checkRangeInput('5', '5', 10, cur), { ok: true, value: { min: 5, max: 5 } });
  });
  it('names the field that is out of range', () => {
    for (const bad of ['0', '11', '2.5', '-1', '+3', 'four', '', '1e1']) assert.deepEqual(checkRangeInput(bad, '4', 10, cur), { ok: false, error: 'min_range', field: 'min' }, bad);
    for (const bad of ['0', '11', 'x']) assert.deepEqual(checkRangeInput('2', bad, 10, cur), { ok: false, error: 'max_range', field: 'max' }, bad);
  });
  it('refuses a minimum above the maximum', () => {
    assert.deepEqual(checkRangeInput('6', '3', 10, cur), { ok: false, error: 'min_above_max', field: 'min' });
  });
  it('reads Eastern Arabic (Hindi) and Persian digits', () => {
    assert.deepEqual(checkRangeInput('٢', '۸', 10, cur), { ok: true, value: { min: 2, max: 8 } });
  });
  it('says so when the range is already the setting', () => {
    assert.deepEqual(checkRangeInput('4', '4', 10, cur), { ok: false, error: 'unchanged', field: null });
  });
  it('has no upper bound of its own when the ceiling is unknown (the API still checks)', () => {
    assert.deepEqual(checkRangeInput('2', '12', null, cur), { ok: true, value: { min: 2, max: 12 } });
  });
});

describe('the link from Delivery', () => {
  it('the anchor lives in a plain module: a value exported from a client component reaches server pages as a function', () => {
    assert.equal(R2_SETTINGS_ID, 'r2-settings');
    const client = readFileSync(new URL('../src/app/(protected)/media-providers/R2Settings.tsx', import.meta.url), 'utf8');
    assert.ok(client.startsWith("'use client'"));
    assert.equal(/^export const /m.test(client), false, 'no plain values exported from the client component');
    const delivery = readFileSync(new URL('../src/app/(protected)/delivery/page.tsx', import.meta.url), 'utf8');
    assert.match(delivery, /from '\.\.\/media-providers\/limit-form'/);
  });
});

describe('who sees it', () => {
  it('moderators read, admins change', () => {
    assert.equal(canReadMedia('Moderator'), true);
    assert.equal(canManageMedia('Moderator'), false);
    assert.equal(canReadMedia('Admin'), true);
    assert.equal(canManageMedia('Admin'), true);
    assert.equal(canReadMedia('viewer'), false);
  });
});

describe('copy', () => {
  const keys = ['liveSummary', 'liveRange', 'liveCeiling', 'liveLimitLink', 'limitTitle', 'limitIntro', 'limitBilling', 'limitMinLabel', 'limitMaxLabel', 'limitHelp', 'limitCost', 'limitSave', 'limitSaving', 'limitSaved', 'limitUndone', 'limitEnforced', 'limitDefault', 'limitUpdated', 'limitErrorMin', 'limitErrorMax', 'limitErrorMinAboveMax', 'limitErrorSave', 'limitUnchanged', 'limitUnavailable', 'readOnlyNote', 'liveStart', 'liveStartCold', 'liveStartWarm', 'liveStartNone'] as const;
  it('every key in en and ar, with the same placeholders', () => {
    const md = (m: unknown) => (m as { mediaDelivery: Record<string, string> }).mediaDelivery;
    for (const k of keys) {
      const e = md(en)[k];
      const a = md(ar)[k];
      assert.ok(e && a, k);
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(holes(a), holes(e), k);
    }
    const mp = (m: unknown) => (m as { mediaProviders: Record<string, string> }).mediaProviders;
    for (const k of ['r2SettingsTitle', 'r2SettingsIntro']) assert.ok(mp(en)[k] && mp(ar)[k], k);
  });
});
