/**
 * Limits of guest content reports (POST /internal/guest-reports). Every attempt counts, the refused ones
 * too. Counted per network prefix and per target, whether or not the target exists.
 *
 * A prefix is an IPv4 address, or an IPv6 /64 and, with more room, the /48 around it: one line can hold
 * 65,536 /64s. The counters' keys are keyed hashes of the UTC day and the prefix (D1 guest_report_limits),
 * deleted within two days, and never stored with a report.
 */
import type { D1Database } from './types';

export interface GuestReportLimits {
  prefixHour: number;
  prefixDay: number;
  wideHour: number;
  wideDay: number;
  targetDay: number;
}

export function guestReportLimitsFor(environment: string | undefined): GuestReportLimits {
  return environment === 'production'
    ? { prefixHour: 5, prefixDay: 20, wideHour: 25, wideDay: 100, targetDay: 40 }
    : { prefixHour: 200, prefixDay: 1000, wideHour: 400, wideDay: 2000, targetDay: 200 };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(raw: string): number[] | null {
  const m = IPV4.exec(raw);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function parseIpv6(raw: string): number[] | null {
  if (!raw.includes(':')) return null;
  let value = raw;
  // An embedded IPv4 tail (::ffff:192.0.2.128)
  const lastColon = value.lastIndexOf(':');
  if (value.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(value.slice(lastColon + 1));
    if (!v4) return null;
    value = `${value.slice(0, lastColon)}:${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export interface NetworkPrefix {
  /** IPv4 address or IPv6 /64 */
  narrow: string;
  /** IPv6 /48; the same as `narrow` for IPv4 */
  wide: string;
}

/** The prefixes an address counts under; one shared bucket for an address that cannot be read. */
export function networkPrefix(rawIp: string | null | undefined): NetworkPrefix {
  let value = (rawIp ?? '').trim().toLowerCase();
  // "[2001:db8::1]:443", "203.0.113.5:54321", "fe80::1%eth0"
  if (value.startsWith('[')) value = value.slice(1, Math.max(1, value.indexOf(']')));
  else if (value.includes('.') && value.split(':').length === 2) value = value.slice(0, value.indexOf(':'));
  const zone = value.indexOf('%');
  if (zone > 0) value = value.slice(0, zone);

  const v4 = parseIpv4(value);
  if (v4) return { narrow: v4.join('.'), wide: v4.join('.') };
  const v6 = parseIpv6(value);
  if (!v6) return { narrow: 'unknown', wide: 'unknown' };
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    const mapped = [v6[6]! >> 8, v6[6]! & 0xff, v6[7]! >> 8, v6[7]! & 0xff].join('.');
    return { narrow: mapped, wide: mapped };
  }
  const hex = (n: number) => v6.slice(0, n).map((g) => g.toString(16)).join(':');
  return { narrow: `${hex(4)}::/64`, wide: `${hex(3)}::/48` };
}

async function keyed(key: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`guest-report-limit:v2|${text}`)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Window {
  key: string;
  limit: number;
  expiresAt: number;
}

/** Counts one attempt in every window and says whether all of them still had room. */
async function count(db: D1Database, windows: Window[]): Promise<boolean> {
  const results = (await db.batch(
    windows.map((w) =>
      db
        .prepare('INSERT INTO guest_report_limits (k, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
        .bind(w.key, w.expiresAt),
    ),
  )) as Array<{ results?: Array<{ n: number }> }>;
  return windows.every((w, i) => Number(results[i]?.results?.[0]?.n ?? 0) <= w.limit);
}

export interface GuestReportAttempt {
  ip: string | null | undefined;
  entityType: string;
  entityId: string;
  childSafety: boolean;
}

/**
 * Whether the attempt may file a report. The network first: one that is over its limit never uses up a
 * target's. A target's child safety reports are counted on their own, so other reports cannot crowd them out.
 */
export async function allowGuestReport(db: D1Database, hmacKey: string, limits: GuestReportLimits, attempt: GuestReportAttempt, now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const expiresAt = now.getTime() + 2 * 86_400_000 - 3_600_000;
  const prefix = networkPrefix(attempt.ip);
  const [narrow, wide, target] = await Promise.all([
    keyed(hmacKey, `${day}|narrow|${prefix.narrow}`),
    keyed(hmacKey, `${day}|wide|${prefix.wide}`),
    keyed(hmacKey, `${day}|target|${attempt.childSafety ? 'child_safety' : 'other'}|${attempt.entityType}:${attempt.entityId}`),
  ]);
  const network = [
    { key: `n:${hour}:${narrow}`, limit: limits.prefixHour, expiresAt },
    { key: `n:${day}:${narrow}`, limit: limits.prefixDay, expiresAt },
    // IPv4 has no wider prefix of its own
    ...(prefix.wide === prefix.narrow
      ? []
      : [
          { key: `w:${hour}:${wide}`, limit: limits.wideHour, expiresAt },
          { key: `w:${day}:${wide}`, limit: limits.wideDay, expiresAt },
        ]),
  ];
  if (!(await count(db, network))) return false;
  return count(db, [{ key: `t:${day}:${target}`, limit: limits.targetDay, expiresAt }]);
}

/** Cron: counters of past days (idx_guest_report_limits_expires). */
export async function purgeGuestReportLimits(db: D1Database, now = new Date()): Promise<void> {
  await db.prepare('DELETE FROM guest_report_limits WHERE expires_at < ?').bind(now.getTime()).run();
}
