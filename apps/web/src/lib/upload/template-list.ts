import type { UploadTemplate } from '@al-ummah/shared-types';

export interface ParsedTemplateList {
  templates: UploadTemplate[];
  defaultTemplateId: string | null;
}

/**
 * GET /api/upload-defaults responds with `{ success, result: { templates, defaultTemplateId } }`
 * and apiRequestServer returns that envelope unchanged. Accepts the envelope or an
 * already unwrapped list. The default comes from `defaultTemplateId` when the API sends
 * it, otherwise from the template flagged `isDefault`.
 */
export function parseTemplateListResponse(response: unknown): ParsedTemplateList {
  if (!response || typeof response !== 'object') {
    return { templates: [], defaultTemplateId: null };
  }
  const envelope = response as { result?: unknown };
  const data = (envelope.result && typeof envelope.result === 'object' ? envelope.result : response) as {
    templates?: UploadTemplate[];
    defaultTemplateId?: string | null;
  };
  const templates = Array.isArray(data.templates) ? data.templates : [];
  const defaultTemplateId = data.defaultTemplateId || templates.find((t) => t.isDefault)?.id || null;
  return { templates, defaultTemplateId };
}
