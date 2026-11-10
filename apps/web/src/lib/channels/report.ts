import { logger } from '@/lib/logger-client';
import { normalizeChannelFailure, type ChannelListFailure } from './report-shape';

export type { ChannelListFailure };

/**
 * The single place a channel list or team failure is reported. The user never
 * sees the raw error (the menu keeps its cached list, forms show friendly
 * copy). It is logged in the browser and sent to the web server's
 * /api/channels/report sink (server logs); the admin Errors pipeline (PR #589)
 * hooks in here, like reportVersionSkew.
 */
export function reportChannelListFailure(event: ChannelListFailure): void {
  logger.error('[channels] channel list or team request failed', event);
  const body = normalizeChannelFailure(event);
  if (!body || typeof window === 'undefined' || typeof fetch === 'undefined') return;
  try {
    void fetch('/api/channels/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    // Reporting never breaks the page
  }
}
