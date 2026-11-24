/**
 * Approvals pages (wiki AUN-WORKFLOWS §6, §10): the diff's values in each language (٠–٩, «،», ٪, the
 * currency's own decimals, names never ids, secrets never shown) and a rule in one line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_ACTIONS, WORKFLOW_STATUSES, type WorkflowField } from '@al-ummah/shared-types';
import { createTranslator } from '../src/i18n/translate';
import { WORKFLOW_STATUS_CHIP, fieldChanges, parseWorkflowView, permissionLabel, ruleSummary, scopeName, statusLabel, workflowPeople, workflowValue } from '../src/lib/workflows';

const en = createTranslator('en');
const ar = createTranslator('ar');
const field = (kind: WorkflowField['kind'], extra: Partial<WorkflowField> = {}): WorkflowField => ({ key: 'k', label: { en: 'K', ar: 'ك' }, kind, before: null, after: null, ...extra });

describe('diff values', () => {
  it('numbers, percentages and money in English and Arabic', () => {
    assert.equal(workflowValue(field('bps'), 290, 'en', en, {}), '2.9%');
    assert.equal(workflowValue(field('bps'), 290, 'ar', ar, {}), '٢٫٩٪');
    assert.equal(workflowValue(field('percent'), 12, 'ar', ar, {}), '١٢٪');
    assert.equal(workflowValue(field('count'), 1500, 'ar', ar, {}), '١٥٠٠');
    assert.match(workflowValue(field('money', { currency: 'USD' }), 1234, 'en', en, {}), /12\.34/);
    assert.match(workflowValue(field('money', { currency: 'JPY' }), 500, 'en', en, {}), /500/);
    assert.doesNotMatch(workflowValue(field('money', { currency: 'JPY' }), 500, 'en', en, {}), /\.00/);
    assert.match(workflowValue(field('money', { currency: 'KWD' }), 1500, 'en', en, {}), /1\.500/);
    assert.doesNotMatch(workflowValue(field('money', { currency: 'USD' }), 1234, 'ar', ar, {}), /[0-9]/);
  });

  it('lists, enums, booleans, people and secrets', () => {
    const list = field('list', { enumLabels: { card: { en: 'Card', ar: 'بطاقة' }, wallet: { en: 'Wallet', ar: 'محفظة' } } });
    assert.equal(workflowValue(list, ['card', 'wallet'], 'en', en, {}), 'Card, Wallet');
    assert.equal(workflowValue(list, ['card', 'wallet'], 'ar', ar, {}), 'بطاقة، محفظة');
    assert.equal(workflowValue(field('bool'), true, 'ar', ar, {}), 'نعم');
    assert.equal(workflowValue(field('person'), 'usr_1', 'en', en, { usr_1: 'Aisha Rahman' }), 'Aisha Rahman');
    assert.equal(workflowValue(field('person'), 'usr_2', 'en', en, {}), 'A team member', 'never the id');
    assert.equal(workflowValue(field('person'), ['usr_1', 'usr_2'], 'ar', ar, { usr_1: 'عائشة', usr_2: 'Yusuf Rahman' }), '\u2068عائشة\u2069، \u2068Yusuf Rahman\u2069', 'mixed directions on one line: each name isolated');
    assert.equal(workflowValue(field('person'), ['usr_1', 'usr_9'], 'en', en, { usr_1: 'Aisha Rahman' }), '\u2068Aisha Rahman\u2069, \u2068A team member\u2069');
    assert.deepEqual(workflowPeople(['usr_1', 'usr_2', 'usr_9'], ar, { usr_1: 'عائشة', usr_2: 'Yusuf Rahman' }), ['عائشة', 'Yusuf Rahman', ar('workflows.someone')], 'one per line on the request page');
    assert.equal(workflowValue(field('secret'), 'replaced', 'en', en, {}), 'Replaced');
    assert.equal(workflowValue(field('text'), null, 'en', en, {}), '—');
    assert.doesNotMatch(workflowValue(field('date'), '2026-11-30T00:00:00Z', 'ar', ar, {}), /[0-9]/, 'dates use the shared formatter');
    assert.ok(fieldChanges(field('secret', { before: 'set', after: 'replaced' })));
    assert.ok(!fieldChanges(field('count', { before: 1, after: 1 })));
  });
});

describe('rules in one line', () => {
  it('money rule: approvers, finance permission, passkey, days; Arabic with ٠–٩ and «،»', () => {
    const rule = WORKFLOW_ACTIONS['support.fees.set'].defaultRule;
    const line = ruleSummary(rule, en, 'en', permissionLabel(en));
    assert.match(line, /1 approver/);
    assert.match(line, /the finance list with Providers and fees/);
    assert.match(line, /passkey to ask and approve/);
    assert.match(line, /7 days/);
    const arLine = ruleSummary(rule, ar, 'ar', permissionLabel(ar));
    assert.doesNotMatch(arLine, /[0-9]/);
    assert.match(arLine, /قائمة المالية بصلاحية المزوّدون والرسوم/);
  });

  it('a direct rule says it takes effect at once', () => {
    assert.match(ruleSummary(WORKFLOW_ACTIONS['features.set'].defaultRule, en, 'en', permissionLabel(en)), /^Takes effect at once/);
  });
});

describe('statuses and views', () => {
  it('every status has a label in both languages and a chip colour', () => {
    for (const s of WORKFLOW_STATUSES) {
      assert.ok(WORKFLOW_STATUS_CHIP[s], s);
      assert.notEqual(statusLabel(en, s), `workflows.status.${s}`);
      assert.notEqual(statusLabel(ar, s), `workflows.status.${s}`);
    }
  });
  it('unknown views fall back to Waiting for me', () => {
    assert.equal(parseWorkflowView('mine'), 'mine');
    assert.equal(parseWorkflowView('nope'), 'waiting');
    assert.equal(parseWorkflowView(undefined), 'waiting');
  });
});

describe('rule scope names (rules page)', () => {
  it('names tier scopes and feature switches in the page language; the default scope has none', () => {
    assert.deepEqual(scopeName('tiers.change', 'default', 'en'), { text: 'The default tier', named: true });
    assert.deepEqual(scopeName('tiers.change', 'assign', 'ar'), { text: 'فئة صانع محتوى', named: true });
    assert.equal(scopeName('features.set', 'creatorSupport', 'en')?.text, 'Creator support');
    assert.equal(scopeName('workflows.rule.set', 'money', 'ar')?.text, 'قواعد المال');
    assert.deepEqual(scopeName('features.set', 'somethingElse', 'en'), { text: 'somethingElse', named: false });
    assert.equal(scopeName('tiers.change', '', 'en'), null);
  });
});
