import { logger } from '@/lib/logger-client';
import type { SkewEvent } from './recovery';

/**
 * The single place a version-skew event is reported, before the page recovers.
 * The error-reporting pipeline (Errors page) hooks in here: forward
 * `event` to it. The user never sees the raw message; they see the
 * "new version" notice instead.
 */
export function reportVersionSkew(event: SkewEvent): void {
  logger.warn('[version-skew] page is older than the deployed build; recovering', event);
}
