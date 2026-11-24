/** The report page's outcome texts: what each does to this kind of item, why one is not offered, refusals. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_ENTITY_TYPES, REPORT_OUTCOMES, REPORT_OUTCOMES_BY_TYPE } from '@al-ummah/shared-types';
import { actionDescription, actionErrorKey, outcomeReasonKey } from '../src/app/(protected)/moderation/reports/[id]/outcomes';
import { createTranslator } from '../src/i18n/translate';

const tEn = createTranslator('en');
const tAr = createTranslator('ar');

describe('report outcomes', () => {
  it('every type may be dismissed, and every reason has a text in both languages', () => {
    for (const type of REPORT_ENTITY_TYPES) assert.ok(REPORT_OUTCOMES_BY_TYPE[type].includes('dismissed'), type);
    for (const reason of ['not_for_type', 'not_for_post_comment', 'item_gone', 'permission'] as const) {
      const key = outcomeReasonKey(reason);
      assert.notEqual(tEn(key), key);
      assert.match(tAr(key), /[\u0600-\u06ff]/);
    }
  });

  it('says what it really does where the general text would not be true', () => {
    for (const type of REPORT_ENTITY_TYPES) for (const action of REPORT_OUTCOMES) {
      const key = actionDescription(type, action);
      if (key) assert.ok(REPORT_OUTCOMES_BY_TYPE[type].includes(action), `${type} ${action}`);
    }
    assert.equal(actionDescription('post', 'deleted'), 'actions.softDeletedDescription');
    assert.equal(actionDescription('video', 'deleted'), null);
    assert.match(tAr('actions.softDeletedDescription'), /٣٠/);
  });

  it('a refusal is never shown as "already closed"', () => {
    assert.equal(actionErrorKey(409, 'item_gone'), 'actions.reasonItemGone');
    assert.equal(actionErrorKey(409, 'outcome_not_available'), 'actions.reasonNotForType');
    assert.equal(actionErrorKey(409), 'actions.alreadyClosed');
    assert.equal(actionErrorKey(403, 'forbidden'), 'actions.reasonPermission');
    assert.equal(actionErrorKey(503, 'not_applied'), 'actions.failed');
  });
});
