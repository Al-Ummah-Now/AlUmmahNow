/**
 * Server-only helper that exchanges an OpenAuth access token for a short-lived
 * (~60 s), single-use, user-bound WebSocket ticket via POST /internal/ws-ticket
 * (#230).
 *
 * Deliberately has NO `'use server'` directive so it cannot be invoked directly
 * as a client-callable Server Action (preventing caller-supplied origin SSRF).
 */

import { logger } from '@/lib/logger-server';

const TICKET_TIMEOUT_MS = 5_000;

/** Converts a WebSocket URL (wss://.../ws or ws://.../ws) into its HTTP origin. */
export function realtimeHttpOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const normalized = rawUrl.trim().replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function resolveInternalApiKey(): Promise<string> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const cf = await getCloudflareContext({ async: true });
    const binding = (cf.env as Record<string, unknown> | undefined)?.INTERNAL_API_KEY as
      | string
      | { get(): Promise<string> }
      | undefined;
    if (typeof binding === 'string' && binding) return binding;
    if (binding && typeof binding === 'object' && typeof binding.get === 'function') {
      const value = await binding.get();
      if (value) return value;
    }
  } catch {
    // next dev / tests: fall through to process.env
  }
  return process.env.INTERNAL_API_KEY || '';
}

async function resolveRealtimeOrigin(): Promise<string | null> {
  const fromProcess = realtimeHttpOrigin(process.env.WEBSOCKET_URL || process.env.NEXT_PUBLIC_WEBSOCKET_URL);
  if (fromProcess) return fromProcess;
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const cf = await getCloudflareContext({ async: true });
    const envUrl = (cf.env as Record<string, unknown> | undefined)?.WEBSOCKET_URL as string | undefined;
    return realtimeHttpOrigin(envUrl);
  } catch {
    return null;
  }
}

export interface MintTicketDeps {
  origin?: string | null;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** Exchanges an OpenAuth access token server-side for a 60-second single-use WS ticket. */
export async function mintRealtimeTicket(accessToken: string, deps: MintTicketDeps = {}): Promise<string | null> {
  if (!accessToken) return null;
  const origin = deps.origin === undefined ? await resolveRealtimeOrigin() : deps.origin;
  const apiKey = deps.apiKey === undefined ? await resolveInternalApiKey() : deps.apiKey;
  if (!origin || !apiKey) {
    logger.warn('[realtime ticket] Realtime ticket minting is not configured');
    return null;
  }
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${origin}/internal/ws-ticket`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TICKET_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn('[realtime ticket] Realtime server rejected ticket request', { status: res.status });
      return null;
    }
    const body = (await res.json()) as { ticket?: unknown };
    return typeof body.ticket === 'string' && body.ticket.startsWith('wst_') ? body.ticket : null;
  } catch (error) {
    logger.warn('[realtime ticket] Failed to mint WebSocket ticket', {
      error: error instanceof Error ? error.name : String(error),
    });
    return null;
  }
}
