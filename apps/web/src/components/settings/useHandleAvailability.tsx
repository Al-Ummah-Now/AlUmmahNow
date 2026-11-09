'use client';

/**
 * Live @handle availability: format problems are reported at once, anything
 * else is checked with the API (checkHandleAvailability, which sends the
 * owner's Bearer token) after a 400 ms pause in typing.
 */

import React, { useEffect, useRef, useState } from 'react';
import { checkHandleAvailability, type HandleProblem } from '@/lib/api/channel-profile';
import { localHandleProblem } from '@/lib/channel-url';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export type HandleStatus =
  | { state: 'idle' | 'checking' | 'current' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: HandleProblem };

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, '');
}

export function useHandleAvailability(
  handle: string,
  currentHandle: string | undefined,
  channelId: string,
  onStatus?: (status: HandleStatus) => void,
): HandleStatus {
  const [status, setStatus] = useState<HandleStatus>({ state: 'idle' });
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);
  const normalized = normalizeHandle(handle);

  useEffect(() => {
    let cancelled = false;
    const report = (next: HandleStatus) => {
      if (cancelled) return;
      setStatus(next);
      statusRef.current?.(next);
    };
    if (!normalized || (currentHandle && normalized === currentHandle)) {
      report({ state: currentHandle && normalized === currentHandle ? 'current' : 'idle' });
      return () => { cancelled = true; };
    }
    const local = localHandleProblem(normalized);
    if (local) {
      report({ state: 'unavailable', reason: local });
      return () => { cancelled = true; };
    }
    report({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await checkHandleAvailability(normalized, channelId);
        if (!result) {
          report({ state: 'idle' });
          return;
        }
        report(result.available ? { state: 'available' } : { state: 'unavailable', reason: result.reason || 'taken' });
      } catch (error) {
        logger.warn('[useHandleAvailability] Availability check failed', { error });
        report({ state: 'idle' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, currentHandle, channelId]);

  return status;
}

/** The status line under a handle field ("@x is available", "This handle is reserved"). */
export function HandleStatusText({ status, handle }: { status: HandleStatus; handle: string }) {
  const { t } = useLanguage();
  const problemText: Record<HandleProblem, string> = {
    too_short: t.channel.handleTooShort,
    too_long: t.channel.handleTooLong,
    invalid_characters: t.channel.handleInvalid,
    reserved: t.channel.handleReserved,
    taken: t.channel.handleTaken,
  };
  return (
    <span data-testid="channel-handle-status" data-state={status.state}>
      {status.state === 'checking' && <span className="text-muted-foreground">{t.channel.handleChecking}</span>}
      {status.state === 'available' && (
        <span className="text-[var(--inline-edit-success)]">{t.channel.handleAvailable.replace('{handle}', normalizeHandle(handle))}</span>
      )}
      {status.state === 'current' && <span className="text-muted-foreground">{t.channel.handleCurrent}</span>}
      {status.state === 'unavailable' && <span className="text-[var(--inline-edit-error)]">{problemText[status.reason]}</span>}
    </span>
  );
}
