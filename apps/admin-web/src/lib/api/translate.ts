'use server';

/**
 * Translate for staff-set en/ar fields (admin-api POST /api/translate/fields; L10N rule,
 * docs/features/LOCALIZED-FIELDS.md). A suggestion only: the form shows it for review before saving.
 */
import type { AdminFieldTranslateRequest, AdminFieldTranslateResponse } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';

export async function translateFields(request: AdminFieldTranslateRequest): Promise<ActionResult<AdminFieldTranslateResponse>> {
  try {
    const data = await fetchAdmin<AdminFieldTranslateResponse>('/api/translate/fields', { method: 'POST', body: JSON.stringify(request) });
    return { ok: true, data };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}) };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
