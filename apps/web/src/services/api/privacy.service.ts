/**
 * Privacy (GDPR) API client (Story 1.3, AC 2).
 *
 * api-videos endpoints:
 * - GET    /api/privacy/export   full data export (JSON)
 * - DELETE /api/privacy/data     erase / anonymise (repeat while complete=false)
 */

import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';

export interface ErasureResult {
  complete: boolean;
  deleted: Record<string, number>;
  anonymized: Record<string, number>;
}

/** Export and erasure run in bounded, resumable passes server-side; give up after this many. */
export const MAX_ERASURE_PASSES = 50;
export const MAX_EXPORT_PASSES = 50;

/** Merge a partial export into the accumulated one: arrays concatenate, the first non-null scalar wins. */
export function mergeExport(
  into: Record<string, unknown> | null,
  part: Record<string, unknown>
): Record<string, unknown> {
  if (!into) return { ...part };
  const out: Record<string, unknown> = { ...into };
  for (const [key, value] of Object.entries(part)) {
    if (Array.isArray(value) && Array.isArray(out[key]) && key !== 'notes') {
      out[key] = [...(out[key] as unknown[]), ...value];
    } else if (out[key] === null || out[key] === undefined) {
      out[key] = value;
    }
  }
  out.complete = part.complete;
  return out;
}

function mergeCounts(into: Record<string, number>, from: Record<string, number> = {}): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
}

export const PrivacyService = {
  /**
   * Fetch the export (following resume tokens for large accounts, merging the
   * array sections) and return it as a Blob ready for download.
   */
  async exportData(): Promise<Blob> {
    let merged: Record<string, unknown> | null = null;
    let resumeToken: string | undefined;
    for (let pass = 0; pass < MAX_EXPORT_PASSES; pass++) {
      const query = resumeToken ? `?resume=${encodeURIComponent(resumeToken)}` : '';
      const response = await fetch(`${getApiUrl()}/api/privacy/export${query}`, {
        headers: await getClientAuthHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) {
        logger.warn('[PrivacyService] Export failed', { status: response.status, pass });
        throw new Error(`export_failed_${response.status}`);
      }
      const part = (await response.json()) as Record<string, unknown>;
      merged = mergeExport(merged, part);
      resumeToken = typeof part.resumeToken === 'string' ? part.resumeToken : undefined;
      if (part.complete === true || !resumeToken) break;
    }
    if (merged) delete merged.resumeToken;
    return new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  },

  /** Erase the account's data, repeating bounded passes until the server reports completion. */
  async eraseData(): Promise<ErasureResult> {
    const total: ErasureResult = { complete: false, deleted: {}, anonymized: {} };
    let resumeToken: string | undefined;
    for (let pass = 0; pass < MAX_ERASURE_PASSES && !total.complete; pass++) {
      const response = await fetch(`${getApiUrl()}/api/privacy/data`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(await getClientAuthHeaders()) },
        body: JSON.stringify({ confirm: 'DELETE', ...(resumeToken && { resumeToken }) }),
      });
      if (!response.ok) {
        logger.warn('[PrivacyService] Erasure failed', { status: response.status, pass });
        throw new Error(`erase_failed_${response.status}`);
      }
      const result = (await response.json()) as ErasureResult & { resumeToken?: string };
      mergeCounts(total.deleted, result.deleted);
      mergeCounts(total.anonymized, result.anonymized);
      total.complete = result.complete === true;
      resumeToken = result.resumeToken;
    }
    logger.info('[PrivacyService] Erasure finished', { complete: total.complete });
    return total;
  },
};

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
