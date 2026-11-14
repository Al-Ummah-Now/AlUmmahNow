/**
 * Server-side reads of the CSAM pages: a failed read is logged and shown as a load error on the
 * page instead of failing it (the intake form must stay usable when the list cannot load).
 */
import type { CsamAccessLogEntry, CsamCaseDetail, CsamCaseSummary, CsamSettings } from '@al-ummah/shared-types';
import { AdminApiError } from '@/lib/api/errors';
import { getCsamCase, getCsamCaseLog, getCsamSettings, getCsamSettingsLog, listCsamCases } from '@/lib/api/csam';
import { logger } from '@/lib/logger';

async function quiet<T>(what: string, read: () => Promise<T>, context: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 404) return null;
    logger.error(`[csam] Failed to load ${what}`, { ...context, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export const getCsamCases = (): Promise<CsamCaseSummary[] | null> => quiet('the cases', listCsamCases);
export const getCsamSettingsSafe = (): Promise<CsamSettings | null> => quiet('the settings', getCsamSettings);
export const getCsamSettingsLogSafe = (): Promise<CsamAccessLogEntry[] | null> => quiet('the settings log', getCsamSettingsLog);

/** The case, or 'not_found' (a 404 page), or null (a load error). */
export async function getCsamCaseSafe(id: string): Promise<CsamCaseDetail | 'not_found' | null> {
  try {
    return await getCsamCase(id);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 404) return 'not_found';
    logger.error('[csam] Failed to load a case', { caseId: id, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export const getCsamCaseLogSafe = (id: string): Promise<CsamAccessLogEntry[] | null> => quiet('a case log', () => getCsamCaseLog(id), { caseId: id });
