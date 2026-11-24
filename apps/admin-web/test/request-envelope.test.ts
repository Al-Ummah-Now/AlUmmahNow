/**
 * The admin-api client's error text (review of #1862): admin-api's error envelope (FEAT-3) puts the code
 * in `error` and the sentence in the admin's language in `message`, so the sentence is shown, never the
 * raw code; older bodies whose `error` is a sentence keep it; the approval workflow's plain-code problems
 * survive (they pick the translated problem text).
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeError, problemsOf } from '../src/lib/api/envelope';

describe('envelopeError', () => {
  it('shows the localized sentence, never the code', () => {
    assert.equal(envelopeError({ success: false, code: 'approval_not_allowed', error: 'approval_not_allowed', message: 'لا يمكنك الموافقة على هذا الطلب أو رفضه.' }, 'x'), 'لا يمكنك الموافقة على هذا الطلب أو رفضه.');
    assert.equal(envelopeError({ success: false, error: 'request_stale', message: 'This changed since the request was made.' }, 'x'), 'This changed since the request was made.');
  });
  it('keeps an older body’s sentence and falls back in order', () => {
    assert.equal(envelopeError({ success: false, error: 'Unknown feature', code: 'not_found', message: 'Not found.' }, 'x'), 'Unknown feature');
    assert.equal(envelopeError({ success: false, errors: [{ message: 'Bad title' }] }, 'x'), 'Bad title');
    assert.equal(envelopeError({ success: false, error: 'conflict' }, 'fallback'), 'conflict', 'a code with no sentence is all there is');
    assert.equal(envelopeError({}, 'fallback'), 'fallback');
  });
});

describe('problemsOf', () => {
  it('keeps settings objects and the workflow’s plain codes', () => {
    assert.deepEqual(problemsOf([{ problem: 'too_high', detail: 'x' }]), [{ problem: 'too_high', detail: 'x' }]);
    assert.deepEqual(problemsOf(['below_floor_approvals', 'not_connected']), [{ problem: 'below_floor_approvals' }, { problem: 'not_connected' }]);
    assert.equal(problemsOf('nope'), undefined);
    assert.equal(problemsOf([]), undefined);
  });
});
