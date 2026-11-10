import { logger } from '@/lib/logger-client';

/**
 * The single place an unexpected upload failure is reported. Users never see
 * the raw text (they get a translated message); it goes here instead.
 * The admin error-reporting pipeline (Errors page, PR #589) hooks in here,
 * next to lib/version-skew/report.ts: forward `context` and `details` to it.
 */
export function reportUploadError(context: string, details: Record<string, unknown>): void {
  const error = details.error;
  logger.error(context, {
    ...details,
    error: error instanceof Error ? { name: error.name, message: error.message } : error,
  });
}
