/**
 * Short-lived, single-use, user-bound WebSocket tickets (#230).
 *
 * Browser apps (web, admin-web) never expose the httpOnly OpenAuth access token
 * to page JavaScript just to authenticate a WebSocket. Instead, the app server
 * mints an opaque 60-second single-use ticket via POST /internal/ws-ticket
 * (authenticated with INTERNAL_API_KEY + the user's Bearer token), hands only
 * the ticket to the browser, and the WebSocket Durable Object redeems it once.
 *
 * Tickets live in the dedicated `ws-tickets` Durable Object instance so single-use
 * redemption is strictly atomic (delete-on-read in single-threaded JS) with zero
 * KV operations.
 */

export const WS_TICKET_PREFIX = 'wst_';
/** Tickets must be redeemed within 60 seconds of minting. */
export const WS_TICKET_TTL_SECONDS = 60;
/** Dedicated WebSocketDurableObject instance holding live tickets. */
export const WS_TICKET_DO_NAME = 'ws-tickets';
const MAX_TICKETS = 50_000;

export interface TicketClaims {
  sub: string;
  email?: string;
  roles?: string[];
  /** Underlying OpenAuth access token expiry (unix seconds) — bounds the socket session. */
  authExpiresAt: number;
  sid?: string;
  authTime?: number;
  iat?: number;
}

export interface MintedTicket {
  ticket: string;
  /** Unix seconds when the ticket itself stops being redeemable (<= now + 60s). */
  expiresAt: number;
  /** Unix seconds when the authenticated socket session must re-authenticate. */
  authExpiresAt: number;
}

interface StoredTicket extends TicketClaims {
  ticketExpiresAt: number;
}

export function isWebSocketTicket(token: string): boolean {
  return token.startsWith(WS_TICKET_PREFIX) && token.length > WS_TICKET_PREFIX.length;
}

function generateTicket(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${WS_TICKET_PREFIX}${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export class TicketStore {
  private entries = new Map<string, StoredTicket>();

  private prune(nowSeconds: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.ticketExpiresAt <= nowSeconds || entry.authExpiresAt <= nowSeconds) {
        this.entries.delete(key);
      }
    }
  }

  mint(claims: TicketClaims, nowMs = Date.now()): MintedTicket | null {
    const nowSeconds = Math.floor(nowMs / 1000);
    if (!claims.sub || !Number.isFinite(claims.authExpiresAt) || claims.authExpiresAt <= nowSeconds) {
      return null;
    }
    if (this.entries.size >= MAX_TICKETS) {
      this.prune(nowSeconds);
      while (this.entries.size >= MAX_TICKETS) {
        const oldest = this.entries.keys().next().value;
        if (!oldest) break;
        this.entries.delete(oldest);
      }
    }
    const ticketExpiresAt = Math.min(nowSeconds + WS_TICKET_TTL_SECONDS, claims.authExpiresAt);
    if (ticketExpiresAt <= nowSeconds) return null;

    const ticket = generateTicket();
    this.entries.set(ticket, {
      sub: claims.sub,
      ...(claims.email !== undefined ? { email: claims.email } : {}),
      ...(claims.roles !== undefined ? { roles: claims.roles } : {}),
      authExpiresAt: claims.authExpiresAt,
      ...(claims.sid !== undefined ? { sid: claims.sid } : {}),
      ...(claims.authTime !== undefined ? { authTime: claims.authTime } : {}),
      ...(claims.iat !== undefined ? { iat: claims.iat } : {}),
      ticketExpiresAt,
    });
    return { ticket, expiresAt: ticketExpiresAt, authExpiresAt: claims.authExpiresAt };
  }

  /** Atomically consumes and returns the ticket's claims, or null if unknown/used/expired. */
  redeem(ticket: string, nowMs = Date.now()): TicketClaims | null {
    if (!isWebSocketTicket(ticket)) return null;
    const entry = this.entries.get(ticket);
    if (!entry) return null;
    // Delete immediately: strictly single-use even if expired
    this.entries.delete(ticket);

    const nowSeconds = Math.floor(nowMs / 1000);
    if (entry.ticketExpiresAt <= nowSeconds || entry.authExpiresAt <= nowSeconds) {
      return null;
    }
    return {
      sub: entry.sub,
      ...(entry.email !== undefined ? { email: entry.email } : {}),
      ...(entry.roles !== undefined ? { roles: entry.roles } : {}),
      authExpiresAt: entry.authExpiresAt,
      ...(entry.sid !== undefined ? { sid: entry.sid } : {}),
      ...(entry.authTime !== undefined ? { authTime: entry.authTime } : {}),
      ...(entry.iat !== undefined ? { iat: entry.iat } : {}),
    };
  }

  get size(): number {
    return this.entries.size;
  }
}
