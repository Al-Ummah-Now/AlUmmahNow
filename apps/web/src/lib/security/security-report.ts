/**
 * Server-side normalisation of security reports (Story 1.2, AC 2).
 *
 * Pure helpers used by /api/security/events and /api/security/csp-report.
 * Everything coming from the browser is untrusted, so reports are size-limited,
 * sanitized and reduced to a fixed set of fields before being logged.
 */

import { sanitizeEventPayload, sanitizeText } from './InputSanitizer';

export const MAX_REPORT_BYTES = 16 * 1024;
export const MAX_REPORTED_EVENTS = 20;

const EVENT_TYPES = new Set(['listener_blocked', 'listener_suspicious', 'message_rejected', 'input_sanitized', 'csp_violation']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

export interface NormalizedSecurityEvent {
  type: string;
  severity: string;
  reason: string;
  context: Record<string, unknown>;
  path?: string;
  timestamp?: string;
}

export function normalizeSecurityEvents(payload: unknown): NormalizedSecurityEvent[] {
  const { value } = sanitizeEventPayload<{ events?: unknown }>(payload, { maxDepth: 4, maxStringLength: 256 });
  const events = Array.isArray(value?.events) ? value.events : [];
  return events
    .slice(0, MAX_REPORTED_EVENTS)
    .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null)
    .filter(event => EVENT_TYPES.has(String(event.type)))
    .map(event => ({
      type: String(event.type),
      severity: SEVERITIES.has(String(event.severity)) ? String(event.severity) : 'medium',
      reason: sanitizeText(String(event.reason ?? ''), 200),
      context: typeof event.context === 'object' && event.context !== null ? (event.context as Record<string, unknown>) : {},
      path: typeof event.path === 'string' ? event.path.split(/[?#]/)[0] : undefined,
      timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
    }));
}

/**
 * Normalise a CSP violation report. Supports the legacy `report-uri` format
 * ({ "csp-report": {...} }) and the Reporting API format ([{ type, body }]).
 */
export function normalizeCspReports(payload: unknown): Record<string, string | number>[] {
  const raw: unknown[] = Array.isArray(payload)
    ? payload.map(entry => (entry as { body?: unknown })?.body)
    : [(payload as { 'csp-report'?: unknown })?.['csp-report']];

  return raw
    .filter((report): report is Record<string, unknown> => typeof report === 'object' && report !== null)
    .slice(0, MAX_REPORTED_EVENTS)
    .map(report => {
      const pick = (...keys: string[]): string => {
        for (const key of keys) {
          const value = report[key];
          if (typeof value === 'string') return sanitizeText(value.split(/[?#]/)[0], 300);
        }
        return '';
      };
      const line = report['line-number'] ?? report.lineNumber;
      return {
        directive: pick('effective-directive', 'effectiveDirective', 'violated-directive'),
        blockedUri: pick('blocked-uri', 'blockedURL'),
        documentUri: pick('document-uri', 'documentURL'),
        sourceFile: pick('source-file', 'sourceFile'),
        disposition: pick('disposition'),
        ...(typeof line === 'number' ? { line } : {}),
      };
    });
}
