/**
 * Settings › Emails editor helpers (src/lib/email-template-model.ts), the nav entry, and that every
 * field, group, placeholder and issue of the editable emails has words in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_PLACEHOLDERS, EMAIL_TEMPLATES, type EmailTemplateIssue } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { insertAt, issueText, previewDocument } from '../src/lib/email-template-model';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';

const HTML = '<html><head><style>@media (prefers-color-scheme:dark){.bg{background:#000}}</style></head><body></body></html>';

describe('preview document', () => {
  it('forces the mail app mode and opens links outside the preview', () => {
    assert.match(previewDocument(HTML, 'dark'), /@media all\{\.bg/);
    assert.match(previewDocument(HTML, 'light'), /@media not all\{\.bg/);
    assert.match(previewDocument(HTML, 'light'), /<head><base target="_blank">/);
  });
});

describe('placeholder chips', () => {
  it('insert at the caret, replace a selection, or append when never focused', () => {
    assert.deepEqual(insertAt('Hello ,', '{name}', 6, 6), { value: 'Hello {name},', caret: 12 });
    assert.deepEqual(insertAt('Hello you,', '{name}', 6, 9), { value: 'Hello {name},', caret: 12 });
    assert.deepEqual(insertAt('Hi', '{name}', null, null), { value: 'Hi{name}', caret: 8 });
  });
});

describe('words for every field', () => {
  for (const [lang, messages] of [['en', en], ['ar', ar]] as const) {
    it(`${lang}: fields, groups, placeholders and issues`, () => {
      const m = messages.emailTemplates as unknown as Record<string, Record<string, string>>;
      for (const def of Object.values(EMAIL_TEMPLATES)) {
        assert.ok(m.keys![def.key], `keys.${def.key}`);
        for (const field of def.fields) {
          assert.ok(m.fields![field.id], `fields.${field.id}`);
          assert.ok(m.groups![field.group], `groups.${field.group}`);
        }
      }
      for (const p of EMAIL_PLACEHOLDERS) assert.ok(m.placeholders![p], `placeholders.${p}`);
    });
  }

  it('issue messages name the placeholder and the language', () => {
    const t = createTranslator('ar');
    const issue: EmailTemplateIssue = { field: 'greeting', lang: 'en', code: 'placeholder_missing', placeholder: 'name' };
    assert.equal(issueText(t, issue, () => 'الإنجليزية'), 'أبقِ {name} في هذا النص.');
    assert.equal(issueText(createTranslator('en'), { field: 'x', lang: 'ar', code: 'required' }, () => 'Arabic'), 'Write this in Arabic.');
  });
});

describe('nav', () => {
  it('shows Emails to admins only', () => {
    const base: NavAccess = { contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true };
    assert.ok(visibleItems({ ...base, emails: true }).some((i) => i.href === '/settings/emails'));
    assert.ok(!visibleItems({ ...base, emails: false }).some((i) => i.href === '/settings/emails'));
  });
});
