/**
 * Review alerts for the native Admin app (wiki AUN-ADMIN-NATIVE "Alerts and the 5-minute target").
 *
 * A held video sends one ReviewAlert message to the dedicated `al-ummah-now-review-alerts`
 * queue (batch size 1, 1 s timeout, #1265). The processor picks the on-call reviewers who may
 * see the item, pushes to their Admin app installs (push_devices.app = 'admin'), schedules the
 * escalations, and clears the alert on the other devices once someone claims the item.
 *
 * Who is alerted is admin-managed (admin-web → Review alerts): the rota, the escalation times
 * and the owners all live in the admin settings (reports D1 site_settings, key
 * REVIEW_ALERT_SETTINGS_KEY). Nothing is per person in code.
 *
 * Privacy: a push carries only "Video held for review · <reason> · <n> min left" and the
 * review id. Never a title, channel, thumbnail, attachment or media URL. Items with a minor
 * present (and other escalations) go only to senior reviewers, at every step.
 *
 * Pure: no Workers runtime.
 */

// ---------------------------------------------------------------------------
// Queue message
// ---------------------------------------------------------------------------

/** Queue names per environment (the processor consumes them; review itself runs in production only). */
export const REVIEW_ALERT_QUEUES = {
  production: 'al-ummah-now-review-alerts',
  stage: 'al-ummah-now-review-alerts-stage',
  qa: 'al-ummah-now-review-alerts-qa',
} as const;

/**
 * - held:     a video was held for a person: alert the on-call reviewers, schedule escalations
 * - escalate: scheduled by `held` (step 1 at escalateAllAfterSeconds, step 2 at escalateSeniorsAfterSeconds)
 * - opened:   a reviewer opened the item (from the alert or the queue): measured only
 * - claimed:  a reviewer claimed it: escalations stop, the other devices get a silent "clear"
 * - decided:  approved, rejected or escalated by a person: every device is cleared
 */
export type ReviewAlertEvent = 'held' | 'escalate' | 'opened' | 'claimed' | 'decided';

export const REVIEW_ALERT_EVENTS = ['held', 'escalate', 'opened', 'claimed', 'decided'] as const satisfies readonly ReviewAlertEvent[];

/** Why the item waits (the only detail a push may show). Mirrors VideoReviewHoldCause plus `minor`. */
export type ReviewAlertReason = 'nsfw' | 'minor' | 'risk' | 'escalation' | 'check_failed' | 'budget' | 'appeal';

export const REVIEW_ALERT_REASONS = ['nsfw', 'minor', 'risk', 'escalation', 'check_failed', 'budget', 'appeal'] as const satisfies readonly ReviewAlertReason[];

export interface ReviewAlertPayload {
  event: ReviewAlertEvent;
  /** The review row id (reports D1 content_reviews.id): the alert's identity and collapse id. */
  reviewId: string;
  /** When the event happened (ms since epoch). */
  at: number;
  /** held: why the item waits. */
  reason?: ReviewAlertReason;
  /** held: a minor is present or the item is an escalation: senior reviewers only. */
  seniorOnly?: boolean;
  /** held: the SLA deadline (ms since epoch) the "n min left" counts down to. */
  deadlineAt?: number;
  /** held: the video (stored for measurement; never pushed). */
  videoId?: string;
  /** escalate: 1 = every eligible reviewer, 2 = seniors and owners. */
  step?: 1 | 2;
  /** opened / claimed / decided: who. */
  userId?: string;
}

export function isReviewAlertPayload(value: unknown): value is ReviewAlertPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!(REVIEW_ALERT_EVENTS as readonly string[]).includes(v.event as string)) return false;
  if (typeof v.reviewId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(v.reviewId)) return false;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return false;
  if (v.event === 'held' && !(REVIEW_ALERT_REASONS as readonly string[]).includes(v.reason as string)) return false;
  if (v.event === 'escalate' && v.step !== 1 && v.step !== 2) return false;
  if ((v.event === 'opened' || v.event === 'claimed') && typeof v.userId !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Settings (admin-managed)
// ---------------------------------------------------------------------------

/** reports D1 `site_settings` key (admin-api writes it, audited; the processor reads it per alert). */
export const REVIEW_ALERT_SETTINGS_KEY = 'review-alerts:settings';

/** One on-call window in the reviewer's own time zone. `end` before `start` crosses midnight. */
export interface ReviewRotaShift {
  /** 0 = Sunday … 6 = Saturday: the day the shift starts. */
  days: number[];
  /** "HH:MM", 24 h. */
  start: string;
  /** "HH:MM", 24 h; "24:00" = end of day. */
  end: string;
}

export interface ReviewRotaEntry {
  userId: string;
  /** May see minor-present items and escalations (the senior_reviewer role). */
  senior: boolean;
  /** IANA time zone the shifts are written in. */
  timeZone: string;
  /** On call during any of these. Empty = never on call (still escalated to at step 1 and 2). */
  shifts: ReviewRotaShift[];
  /** Paused (leave, sick): no alerts at all, not even escalations. */
  paused?: boolean;
}

export interface ReviewAlertSettings {
  /** Off: nothing is pushed (the queue still records the timings). */
  enabled: boolean;
  /** Unclaimed this long: alert every eligible reviewer in the rota (on call or not). */
  escalateAllAfterSeconds: number;
  /** Unclaimed this long: alert the senior reviewers and the owners. */
  escalateSeniorsAfterSeconds: number;
  /** Alerted at step 2 for every item (the owner is the first senior reviewer, VR7). */
  owners: string[];
  rota: ReviewRotaEntry[];
}

export const DEFAULT_REVIEW_ALERT_SETTINGS: ReviewAlertSettings = {
  enabled: true,
  escalateAllAfterSeconds: 120,
  escalateSeniorsAfterSeconds: 240,
  owners: [],
  rota: [],
};

/** Bounds an admin may set (seconds). The 5-minute target needs both steps inside it. */
export const REVIEW_ESCALATION_BOUNDS = { min: 30, max: 3600 } as const;
export const MAX_ROTA_ENTRIES = 200;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type SettingsCheck = { ok: true; value: ReviewAlertSettings } | { ok: false; error: string };

/** Validates and normalises admin input (dedupes users, sorts days). */
export function validateReviewAlertSettings(input: unknown): SettingsCheck {
  if (!input || typeof input !== 'object') return { ok: false, error: 'settings must be an object' };
  const v = input as Record<string, unknown>;
  if (typeof v.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
  const secs = (key: string): number | string => {
    const n = v[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < REVIEW_ESCALATION_BOUNDS.min || n > REVIEW_ESCALATION_BOUNDS.max) {
      return `${key} must be a whole number of seconds from ${REVIEW_ESCALATION_BOUNDS.min} to ${REVIEW_ESCALATION_BOUNDS.max}`;
    }
    return n;
  };
  const all = secs('escalateAllAfterSeconds');
  if (typeof all === 'string') return { ok: false, error: all };
  const seniors = secs('escalateSeniorsAfterSeconds');
  if (typeof seniors === 'string') return { ok: false, error: seniors };
  if (seniors <= all) return { ok: false, error: 'escalateSeniorsAfterSeconds must be later than escalateAllAfterSeconds' };
  const userId = (u: unknown) => typeof u === 'string' && /^[A-Za-z0-9_:.@-]{1,128}$/.test(u);
  if (!Array.isArray(v.owners) || !v.owners.every(userId)) return { ok: false, error: 'owners must be a list of user ids' };
  if (!Array.isArray(v.rota) || v.rota.length > MAX_ROTA_ENTRIES) return { ok: false, error: `rota must be a list of at most ${MAX_ROTA_ENTRIES} reviewers` };
  const seen = new Set<string>();
  const rota: ReviewRotaEntry[] = [];
  for (const [i, raw] of v.rota.entries()) {
    const e = raw as Record<string, unknown>;
    if (!e || typeof e !== 'object' || !userId(e.userId)) return { ok: false, error: `rota[${i}].userId is missing` };
    if (seen.has(e.userId as string)) return { ok: false, error: `rota[${i}] repeats a reviewer` };
    seen.add(e.userId as string);
    if (typeof e.senior !== 'boolean') return { ok: false, error: `rota[${i}].senior must be true or false` };
    if (!isValidTimeZone(e.timeZone)) return { ok: false, error: `rota[${i}].timeZone is not a time zone` };
    if (!Array.isArray(e.shifts) || e.shifts.length > 28) return { ok: false, error: `rota[${i}].shifts must be a list of at most 28` };
    const shifts: ReviewRotaShift[] = [];
    for (const [j, s] of (e.shifts as unknown[]).entries()) {
      const sh = s as Record<string, unknown>;
      const days = Array.isArray(sh?.days) ? (sh.days as unknown[]) : null;
      if (!days || days.length === 0 || !days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
        return { ok: false, error: `rota[${i}].shifts[${j}].days must be weekdays 0-6` };
      }
      if (typeof sh.start !== 'string' || !HHMM.test(sh.start) || sh.start === '24:00') return { ok: false, error: `rota[${i}].shifts[${j}].start must be HH:MM` };
      if (typeof sh.end !== 'string' || !HHMM.test(sh.end)) return { ok: false, error: `rota[${i}].shifts[${j}].end must be HH:MM` };
      if (sh.start === sh.end) return { ok: false, error: `rota[${i}].shifts[${j}] is empty` };
      shifts.push({ days: [...new Set(days as number[])].sort(), start: sh.start, end: sh.end });
    }
    rota.push({ userId: e.userId as string, senior: e.senior, timeZone: e.timeZone as string, shifts, ...(e.paused === true ? { paused: true } : {}) });
  }
  return {
    ok: true,
    value: { enabled: v.enabled, escalateAllAfterSeconds: all, escalateSeniorsAfterSeconds: seniors, owners: [...new Set(v.owners as string[])], rota },
  };
}

/** Stored JSON → settings; anything unreadable falls back to the defaults (alerts stay on, nobody on the rota). */
export function parseReviewAlertSettings(raw: string | null | undefined): ReviewAlertSettings {
  if (!raw) return DEFAULT_REVIEW_ALERT_SETTINGS;
  try {
    const checked = validateReviewAlertSettings(JSON.parse(raw));
    return checked.ok ? checked.value : DEFAULT_REVIEW_ALERT_SETTINGS;
  } catch {
    return DEFAULT_REVIEW_ALERT_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// Who gets an alert
// ---------------------------------------------------------------------------

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday and minute of the day at `at` in `timeZone`. */
export function localTime(at: number, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: WEEKDAY[get('weekday')] ?? 0, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** On call now? Shifts that cross midnight belong to the day they start. */
export function isOnCall(entry: ReviewRotaEntry, at: number): boolean {
  if (entry.paused || entry.shifts.length === 0) return false;
  const { day, minute } = localTime(at, entry.timeZone);
  const yesterday = (day + 6) % 7;
  return entry.shifts.some((s) => {
    const start = toMinute(s.start);
    const end = toMinute(s.end);
    if (start < end) return s.days.includes(day) && minute >= start && minute < end;
    // Crosses midnight: the evening part today, the morning part from yesterday's shift
    return (s.days.includes(day) && minute >= start) || (s.days.includes(yesterday) && minute < end);
  });
}

/**
 * Who an alert step goes to (user ids, sorted).
 * - step 0 (held): on-call reviewers who may see the item
 * - step 1: every reviewer in the rota who may see the item, on call or not
 * - step 2: the senior reviewers in the rota and the owners
 * Senior-only items (a minor present, escalations) never reach a non-senior. Owners count as
 * seniors (VR7: the owner is the first senior reviewer). Paused reviewers get nothing.
 */
export function reviewAlertRecipients(settings: ReviewAlertSettings, item: { seniorOnly: boolean }, step: 0 | 1 | 2, at: number): string[] {
  if (!settings.enabled) return [];
  const out = new Set<string>();
  for (const e of settings.rota) {
    if (e.paused) continue;
    if (item.seniorOnly && !e.senior) continue;
    if (step === 0 && !isOnCall(e, at)) continue;
    if (step === 2 && !e.senior) continue;
    out.add(e.userId);
  }
  if (step === 2) {
    const paused = new Set(settings.rota.filter((e) => e.paused).map((e) => e.userId));
    for (const owner of settings.owners) if (!paused.has(owner)) out.add(owner);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// What a push says (rendered per device locale; nothing else is sent)
// ---------------------------------------------------------------------------

const REASON_TEXT: Record<'en' | 'ar', Record<ReviewAlertReason, string>> = {
  en: { nsfw: 'NSFW', minor: 'Minor present', risk: 'Flagged', escalation: 'Escalated', check_failed: 'Check failed', budget: 'Check paused', appeal: 'Appeal' },
  ar: { nsfw: 'محتوى غير لائق', minor: 'وجود قاصر', risk: 'مُعلَّم', escalation: 'مُصعَّد', check_failed: 'تعذّر الفحص', budget: 'الفحص متوقف', appeal: 'استئناف' },
};

/** Whole minutes left until the deadline (0 when it passed). */
export function minutesLeft(deadlineAt: number | null | undefined, now: number): number | null {
  if (!deadlineAt) return null;
  return Math.max(0, Math.ceil((deadlineAt - now) / 60000));
}

/** "Video held for review · NSFW · 4 min left" (ar: «مرئي» wording), plus the Open / Claim action labels. */
export function reviewAlertText(
  reason: ReviewAlertReason,
  minutes: number | null,
  locale: string | null | undefined,
): { title: string; body: string; openLabel: string; claimLabel: string } {
  const ar = (locale ?? '').toLowerCase().startsWith('ar');
  const parts = ar ? ['مرئي محجوز للمراجعة', REASON_TEXT.ar[reason]] : ['Video held for review', REASON_TEXT.en[reason]];
  if (minutes !== null) parts.push(ar ? `بقي ${minutes} د` : `${minutes} min left`);
  return {
    title: ar ? 'طابور المراجعة' : 'Review queue',
    body: parts.join(' · '),
    openLabel: ar ? 'فتح' : 'Open',
    claimLabel: ar ? 'استلام' : 'Claim',
  };
}
