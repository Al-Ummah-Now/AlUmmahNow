/**
 * admin-web's formatCount: the shared formatCountNoun (@al-ummah/shared-types, tested with the
 * web suite) with a no-break space, so a count never wraps away from its noun in a list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount } from '../src/i18n/translate';

const nb = ' ';

describe('admin formatCount', () => {
  it('Arabic agreement with the number kept on its noun', () => {
    assert.equal(formatCount(3, 'comment', 'ar'), `٣${nb}تعليقات`);
    assert.equal(formatCount(14, 'like', 'ar'), `١٤${nb}إعجابًا`);
    assert.equal(formatCount(2, 'like', 'ar'), 'إعجابان');
    assert.equal(formatCount(114, 'video', 'ar'), `١١٤${nb}مرئيًا`);
    assert.equal(formatCount(1520, 'like', 'ar'), `١٬٥٢٠${nb}إعجابًا`);
  });
  it('English', () => {
    assert.equal(formatCount(6, 'view', 'en'), `6${nb}views`);
    assert.equal(formatCount(1, 'subscriber', 'en'), `1${nb}subscriber`);
  });
});
