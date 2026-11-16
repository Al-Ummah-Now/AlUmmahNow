/**
 * Pure helpers of the Settings › Emails editor (EmailTemplateEditor.tsx), kept apart from React so
 * they are tested without a browser (test/email-template-editor.test.ts).
 */
import type { EmailTemplateIssue, EmailTemplateLang } from '@al-ummah/shared-types';
import type { MessageKey, Translator } from '@/i18n/translate';

export type Mode = 'light' | 'dark';

/** The mail app's light or dark mode: the email's own dark rules always, or never, apply. */
export function previewDocument(html: string, mode: Mode): string {
  const forced = html.replace('@media (prefers-color-scheme:dark){', mode === 'dark' ? '@media all{' : '@media not all{');
  // Links open outside the preview
  return forced.replace('<head>', '<head><base target="_blank">');
}

export function issueText(t: Translator, issue: EmailTemplateIssue, langName: (l: EmailTemplateLang) => string): string {
  return t(`emailTemplates.issues.${issue.code}` as MessageKey, {
    lang: langName(issue.lang),
    max: String(issue.max ?? ''),
    placeholder: `{${issue.placeholder ?? ''}}`,
    example: '{name}',
  });
}

/** Inserts `token` at the selection of `input` (the end when it was never focused). */
export function insertAt(value: string, token: string, start: number | null, end: number | null): { value: string; caret: number } {
  const s = start ?? value.length;
  const e = end ?? s;
  return { value: value.slice(0, s) + token + value.slice(e), caret: s + token.length };
}

