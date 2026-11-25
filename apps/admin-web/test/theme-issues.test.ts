/** The theme builder's problems in the admin's words (site-theme/builder/issues.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, getMessages } from '../src/i18n/translate';
import { blockReasons, blockedText, issueText, issueWhere } from '../src/app/(protected)/site-theme/builder/issues';
import type { Issue } from '@al-ummah/theme-packages';

const plain = (s: string) => s.replace(/[⁦⁩]/g, '');
const contrast: Issue = { path: 'tokens.color.dark.textMuted', message: 'x', code: 'contrast', params: { color: 'textMuted', background: 'bg', ratio: 3.111, min: 4.5 } };

describe('theme builder problems', () => {
  it('words a problem in both languages, with the language’s digits', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    assert.equal(plain(issueText(en, 'en', contrast)), 'textMuted on bg has a contrast of 3.11:1. It needs 4.5:1 (WCAG AA).');
    const words = plain(issueText(ar, 'ar', contrast));
    assert.match(words, /^تباين textMuted على bg هو ٣٫١١:١، والمطلوب ٤٫٥:١/);
    assert.equal(plain(issueText(en, 'en', { path: 'x', message: 'names assets/a.png', code: 'fileMissing', params: { file: 'assets/a.png' } })), 'The file assets/a.png is not in this theme. Upload it or choose another.');
  });

  it('never shows the validator’s English for a problem it has no code for', () => {
    for (const l of ['en', 'ar'] as const) {
      const words = issueText(createTranslator(l), l, { path: 'x', message: 'RAW ENGLISH' });
      assert.ok(words && !words.includes('RAW'));
      assert.equal(words, (getMessages(l) as unknown as { themeBuilder: { issues: { invalid: string } } }).themeBuilder.issues.invalid);
    }
  });

  it('leaves no placeholder in any problem’s words', () => {
    const params = { min: 1, max: 2, ratio: 3, color: 'a', background: 'b', ref: 'r', file: 'f', type: 'png' };
    for (const l of ['en', 'ar'] as const) {
      const all = (getMessages(l) as unknown as { themeBuilder: { issues: Record<string, string> } }).themeBuilder.issues;
      for (const code of Object.keys(all)) assert.doesNotMatch(issueText(createTranslator(l), l, { path: 'x', message: '', code: code as Issue['code'], params }), /[{}]/, `${l} ${code}`);
    }
  });

  it('says where it is in words', () => {
    const en = createTranslator('en');
    assert.deepEqual(issueWhere(en, 'description.ar'), { label: 'Description (Arabic)', name: '' });
    assert.deepEqual(issueWhere(en, 'tokens.color.dark.textMuted'), { label: 'Colors (Dark)', name: 'textMuted' });
    assert.deepEqual(issueWhere(en, 'components.header.colors.light.bg'), { label: 'Component color (Light)', name: 'header bg' });
    assert.deepEqual(issueWhere(en, 'assets/a.png'), { label: 'Files', name: 'a.png' });
    assert.deepEqual(issueWhere(en, 'imagery.logo'), { label: 'Imagery', name: 'logo' });
    assert.deepEqual(issueWhere(createTranslator('ar'), 'name.en'), { label: createTranslator('ar')('localized.fieldIn', { field: 'الاسم', lang: createTranslator('ar')('localized.langEnglish') }), name: '' });
  });

  it('names the real reason publishing is blocked', () => {
    const empty: Issue = { path: 'description.ar', message: '', code: 'empty' };
    const file: Issue = { path: 'imagery.logo', message: '', code: 'fileMissing', params: { file: 'assets/x.png' } };
    assert.deepEqual(blockReasons([empty]), ['texts']);
    assert.deepEqual(blockReasons([contrast]), ['contrast']);
    assert.deepEqual(blockReasons([{ path: 'materials.radius', message: '', code: 'wrongType' }, file, contrast, empty]), ['texts', 'contrast', 'files', 'values']);
    const en = createTranslator('en');
    assert.equal(blockedText(en, 'en', [empty]), 'Publishing is blocked: a text is missing or too long. Drafts still save.');
    assert.doesNotMatch(blockedText(en, 'en', [empty]), /WCAG/);
    assert.match(blockedText(createTranslator('ar'), 'ar', [empty, file]), /^النشر متوقف: نص ناقص أو طويل جدًا وملف/);
  });
});
