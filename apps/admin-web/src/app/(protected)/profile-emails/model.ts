/** Profile emails page helpers, free of React so they are unit tested. */
import { PROFILE_EMAILS_CHECK_MAX_AGE_HOURS, type AdminJob, type ProfileEmailsResult } from '@al-ummah/shared-types';

/** The newest check a repair may follow: finished, recent, with something to write; null when there is none. */
export function repairableCheck(jobs: readonly AdminJob[], nowMs = Date.now()): { id: string; records: number } | null {
  const latest = jobs.find((j) => j.status === 'succeeded');
  if (!latest || latest.params.mode !== 'check' || !latest.finishedAt) return null;
  if (nowMs - Date.parse(latest.finishedAt) > PROFILE_EMAILS_CHECK_MAX_AGE_HOURS * 3_600_000) return null;
  const r = latest.result as unknown as ProfileEmailsResult | null;
  const records = r ? r.differs + r.missing + r.channels : 0;
  return records > 0 ? { id: latest.id, records } : null;
}

/** The report's pages, as the result lists them. */
export const reportPages = (result: ProfileEmailsResult | null): number[] => (Array.isArray(result?.reportPages) ? result.reportPages : []);
