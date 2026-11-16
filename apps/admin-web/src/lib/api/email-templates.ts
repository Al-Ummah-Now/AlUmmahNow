'use server';

/**
 * Settings › Emails (admin-api /api/email-templates, emails:manage). Reads throw AdminApiError;
 * changes return a result with admin-api's code and per-field codes (`<lang>.<field>`).
 */
import type { EmailTemplateContent, EmailTemplateKey, EmailTemplateLang, EmailTemplateState, EmailTemplateVersion } from '@al-ummah/shared-types';
import { AdminApiError } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';

export type TemplateResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; fields?: Record<string, string> };

async function result<T>(run: () => Promise<T>): Promise<TemplateResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, ...(error.code ? { code: error.code } : {}), ...(error.fields ? { fields: error.fields } : {}) };
    return { ok: false, status: 500 };
  }
}

export interface TemplateSummary {
  key: EmailTemplateKey;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
  issues: { field: string; lang: EmailTemplateLang; code: string; placeholder?: string }[];
}

export interface PreviewSample {
  channels?: 'none' | 'one' | 'many' | 'transferred';
  withName?: boolean;
  withNote?: boolean;
}

export async function listEmailTemplates(): Promise<TemplateSummary[]> {
  return (await fetchAdmin<{ items: TemplateSummary[] }>('/api/email-templates')).items;
}

export async function getEmailTemplate(key: EmailTemplateKey): Promise<EmailTemplateState> {
  return fetchAdmin<EmailTemplateState>(`/api/email-templates/${key}`);
}

export async function listEmailTemplateVersions(key: EmailTemplateKey, before?: number): Promise<TemplateResult<{ items: EmailTemplateVersion[]; next: number | null }>> {
  return result(() => fetchAdmin(`/api/email-templates/${key}/versions${before ? `?before=${before}` : ''}`));
}

export async function saveEmailTemplate(key: EmailTemplateKey, baseVersion: number, content: EmailTemplateContent): Promise<TemplateResult<EmailTemplateState>> {
  return result(() => fetchAdmin(`/api/email-templates/${key}`, { method: 'PUT', body: JSON.stringify({ baseVersion, content }) }));
}

export async function restoreEmailTemplate(key: EmailTemplateKey, version: number, baseVersion: number, undo = false): Promise<TemplateResult<EmailTemplateState>> {
  return result(() => fetchAdmin(`/api/email-templates/${key}/restore`, { method: 'POST', body: JSON.stringify({ version, baseVersion, undo }) }));
}

export async function previewEmailTemplate(key: EmailTemplateKey, content: EmailTemplateContent, locale: EmailTemplateLang, sample: PreviewSample): Promise<TemplateResult<EmailPreview>> {
  return result(() => fetchAdmin(`/api/email-templates/${key}/preview`, { method: 'POST', body: JSON.stringify({ content, locale, sample }) }));
}

export async function sendEmailTemplateTest(key: EmailTemplateKey, content: EmailTemplateContent, locale: EmailTemplateLang): Promise<TemplateResult<{ to: string; status: string; remaining: number }>> {
  return result(() => fetchAdmin(`/api/email-templates/${key}/test`, { method: 'POST', body: JSON.stringify({ content, locale }) }));
}
