import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITLEMENT_CATALOGUE, getEntitlementDefinition } from '@al-ummah/shared-types';
import { canManagePlans, collectPlanValues, entitlementInputText, parseEntitlementInput } from '../src/lib/plan-values';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const def = (k: string) => getEntitlementDefinition(k)!;

describe('plan form values', () => {
  it('parses numbers, unlimited, booleans and enums', () => {
    assert.deepEqual(parseEntitlementInput(def('channel.max'), ' 3 '), { ok: true, value: 3 });
    assert.deepEqual(parseEntitlementInput(def('channel.max'), 'Unlimited'), { ok: true, value: 'unlimited' });
    assert.deepEqual(parseEntitlementInput(def('channel.handle'), 'false'), { ok: true, value: false });
    assert.deepEqual(parseEntitlementInput(def('discussions.theming'), 'full'), { ok: true, value: 'full' });
  });

  it('rejects invalid input', () => {
    for (const [key, raw] of [['channel.max', '-1'], ['channel.max', 'abc'], ['channel.max', '1.5'], ['discussions.theming', 'pink']]) {
      assert.equal(parseEntitlementInput(def(key), raw).ok, false, raw);
    }
  });

  it('leaves blank fields out and reports the first invalid one', () => {
    assert.deepEqual(collectPlanValues(ENTITLEMENT_CATALOGUE, { 'channel.max': '2', 'storage.gb': ' ' }), { values: { 'channel.max': 2 } });
    assert.ok('error' in collectPlanValues(ENTITLEMENT_CATALOGUE, { 'channel.max': 'x' }));
  });

  it('round-trips a value to text', () => {
    assert.equal(entitlementInputText('unlimited'), 'unlimited');
    assert.equal(entitlementInputText(false), 'false');
    assert.equal(entitlementInputText(undefined), '');
  });

  it('lets only admins and super admins manage plans', () => {
    assert.equal(canManagePlans('admin'), true);
    assert.equal(canManagePlans('super_admin'), true);
    assert.equal(canManagePlans('moderator'), false);
    assert.equal(canManagePlans(undefined), false);
  });

  it('translates every plans string', () => {
    assert.deepEqual(Object.keys(ar.plans).sort(), Object.keys(en.plans).sort());
    for (const [key, value] of Object.entries(ar.plans)) assert.match(value as string, /[؀-ۿ]/, key);
  });
});
