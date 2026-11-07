/**
 * SecurityEventLogger (Story 1.2, AC 2)
 *
 * Collects security events raised in the browser (blocked event listeners,
 * suspicious handlers, rejected cross-origin messages, sanitized payloads, CSP
 * violations), writes them to the client logger and ships them in small batches
 * to the web app's `/api/security/events` route, which records them with the
 * server logger so they reach the centralized log service.
 *
 * Security events never contain user content: only the event category, a
 * machine-readable reason, and short, truncated context (event type, origin,
 * pattern id).
 */

import { logger } from '@/lib/logger-client';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export type SecurityEventType =
  | 'listener_blocked'
  | 'listener_suspicious'
  | 'message_rejected'
  | 'input_sanitized'
  | 'csp_violation';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: SecuritySeverity;
  reason: string;
  context?: Record<string, string | number | boolean>;
  timestamp: string;
  path?: string;
}

export interface SecurityEventLoggerOptions {
  endpoint?: string;
  /** Flush when this many events are buffered. */
  batchSize?: number;
  /** Hard cap on buffered events; older events are dropped first. */
  maxBuffer?: number;
  /** Optional transport override (tests). */
  transport?: (endpoint: string, events: SecurityEvent[]) => Promise<void>;
}

const MAX_CONTEXT_VALUE_LENGTH = 200;

function truncateContext(
  context: SecurityEvent['context'],
): SecurityEvent['context'] | undefined {
  if (!context) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context).slice(0, 10)) {
    out[key] = typeof value === 'string' ? value.slice(0, MAX_CONTEXT_VALUE_LENGTH) : value;
  }
  return out;
}

async function defaultTransport(endpoint: string, events: SecurityEvent[]): Promise<void> {
  if (typeof fetch === 'undefined') return;
  const body = JSON.stringify({ events });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const queued = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    if (queued) return;
  }
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  });
}

export class SecurityEventLogger {
  private buffer: SecurityEvent[] = [];
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly maxBuffer: number;
  private readonly transport: (endpoint: string, events: SecurityEvent[]) => Promise<void>;
  private flushing: Promise<void> | null = null;

  constructor(options: SecurityEventLoggerOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/security/events';
    this.batchSize = options.batchSize ?? 10;
    this.maxBuffer = options.maxBuffer ?? 100;
    this.transport = options.transport ?? defaultTransport;
  }

  log(event: Omit<SecurityEvent, 'timestamp'> & { timestamp?: string }): SecurityEvent {
    const entry: SecurityEvent = {
      type: event.type,
      severity: event.severity,
      reason: event.reason.slice(0, MAX_CONTEXT_VALUE_LENGTH),
      context: truncateContext(event.context),
      timestamp: event.timestamp ?? new Date().toISOString(),
      path: event.path ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
    };

    const logData = { type: entry.type, reason: entry.reason, ...entry.context };
    if (entry.severity === 'high' || entry.severity === 'critical') {
      logger.error('[Security] ' + entry.type, logData);
    } else {
      logger.warn('[Security] ' + entry.type, logData);
    }

    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    if (this.buffer.length >= this.batchSize || entry.severity === 'critical') {
      void this.flush();
    }
    return entry;
  }

  getBufferedEvents(): ReadonlyArray<SecurityEvent> {
    return [...this.buffer];
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0, this.buffer.length);
    this.flushing = (async () => {
      try {
        await this.transport(this.endpoint, events);
      } catch (error) {
        logger.warn('[Security] Failed to ship security events', {
          count: events.length,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }
}

/** Shared instance used by the validator, sanitizer and CSP listener. */
export const securityEventLogger = new SecurityEventLogger();
