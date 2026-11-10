import { logger } from '@/lib/logger-client';
import { reportError, withoutErrorForwarding } from '@/lib/errors/reporter';
import type { SkewEvent } from './recovery';

/**
 * The single place a version-skew event is reported, before the page recovers:
 * it goes to the admin Errors page (kind "skew") with where it was caught and
 * whether the reload waits for an upload. The user never sees the raw message;
 * they see the "new version" notice instead.
 */
export function reportVersionSkew(event: SkewEvent): void {
  withoutErrorForwarding(() => logger.warn('[version-skew] page is older than the deployed build; recovering', event));
  const error = Object.assign(new Error(event.message || 'Version skew'), { name: event.name || 'VersionSkew' });
  reportError(error, { kind: 'skew', extra: { source: event.source, deferred: event.deferred } });
}
