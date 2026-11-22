'use client';

/**
 * When a community post goes live (Story 29.4): now, or at a date and time 5 minutes to a year
 * ahead (the API's window, api-videos lib/post-schedule.ts), on the wall clock of a time zone the
 * viewer picks (their own by default). Owner review: the date and time read in the page's language
 * and digits (Arabic ٠–٩), one icon each, and the zone has a friendly localized name with its GMT
 * offset, changeable through a searchable picker.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { Clock, Globe } from 'lucide-react';
import { OptionCard } from '@/components/ui/OptionCard';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { LocalizedDatePicker, isoDay } from '@/components/ui/LocalizedDatePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/hooks/useLanguage';
import { formatDateTime, formatTime } from '@al-ummah/shared-types';
import { allZones, browserZone, dateToWallTime, isZone, offsetLabel, wallTimeToDate, zoneCity, zoneLabel, zoneName } from '@/lib/time/zones';

export const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000;
export const SCHEDULE_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
/** The time list's step (minutes) */
export const TIME_STEP_MINUTES = 15;
/** The viewer's last picked zone (a per-viewer convenience; the browser's zone without it) */
const ZONE_KEY = 'aun:post-schedule-zone';

export type ScheduleProblem = 'required' | 'too_soon' | 'too_far';

export interface ScheduleState {
  /** True when "Schedule for later" is picked */
  later: boolean;
  /** "YYYY-MM-DDTHH:mm" on the wall clock of `zone` ('' or half of it while not picked) */
  local: string;
  /** IANA zone the time is in; the browser's own when absent */
  zone?: string;
}

const zoneOf = (state: Pick<ScheduleState, 'zone'>) => (state.zone && isZone(state.zone) ? state.zone : browserZone());

/** The problem with a wall-clock time in `zone`, or null when it can be scheduled. */
export function scheduleProblem(local: string, now = Date.now(), zone = browserZone()): ScheduleProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return 'required';
  const t = wallTimeToDate(local, zone).getTime();
  if (Number.isNaN(t)) return 'required';
  if (t < now + SCHEDULE_MIN_LEAD_MS) return 'too_soon';
  if (t > now + SCHEDULE_MAX_LEAD_MS) return 'too_far';
  return null;
}

/** A Date as a wall-clock value in `zone` (default: the browser's). */
export function toLocalInput(date: Date, zone = browserZone()): string {
  return dateToWallTime(date, zone);
}

/** A post's scheduled time in the viewer's language, digits and zone. */
/**
 * "Nov 27, 2026, 8:14 PM (GMT−5)" / «٢٧ نوفمبر ٢٠٢٦، ٨:١٤ م (GMT−٥)»: the viewer's local time with its
 * zone, so a scheduled time never reads as if it were the channel's (the offset is an LTR isolate in
 * Arabic, as in zoneLabel).
 */
export function formatScheduledAt(iso: string, locale: string, zone = browserZone()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // The shared formatter: Arabic ٠–٩, English 0–9, the same on the server and in every browser
  const when = formatDateTime(locale, date, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });
  const offset = offsetLabel(zone, locale, date);
  return `${when} (${locale === 'ar' ? `\u2066${offset}\u2069` : offset})`;
}

export function scheduleStateFrom(iso?: string | null, zone = browserZone()): ScheduleState {
  return iso ? { later: true, local: toLocalInput(new Date(iso), zone), zone } : { later: false, local: '', zone };
}

/** A wall-clock value from its date and time parts (incomplete until both are set). */
export function joinLocal(date: string, time: string): string {
  return date || time ? `${date}T${time}` : '';
}

/** The ISO time to send, or null for "publish now". */
export function scheduledIso(state: ScheduleState): string | null {
  if (!state.later || !state.local) return null;
  const at = wallTimeToDate(state.local, zoneOf(state));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The time list: every step of the day, plus the current value when it is off the step. */
export function timeSlots(current: string, step = TIME_STEP_MINUTES): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const slots = Array.from({ length: (24 * 60) / step }, (_, i) => `${pad(Math.floor((i * step) / 60))}:${pad((i * step) % 60)}`);
  if (/^\d{2}:\d{2}$/.test(current) && !slots.includes(current)) {
    slots.push(current);
    slots.sort();
  }
  return slots;
}

/** "19:30" as people read it ("7:30 PM", «٧:٣٠ م»). */
export function formatSlot(time: string, locale: string): string {
  const [h, m] = time.split(':').map(Number);
  return formatTime(locale, new Date(Date.UTC(2026, 0, 1, h, m)), { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

/** The zone a new pick starts in: the viewer's last pick, else the browser's. Client only. */
export function preferredZone(): string {
  return readSavedZone() ?? browserZone();
}

function readSavedZone(): string | null {
  try {
    const saved = window.localStorage.getItem(ZONE_KEY);
    return saved && isZone(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveZone(zone: string) {
  try {
    window.localStorage.setItem(ZONE_KEY, zone);
  } catch {
    // Private mode: the pick lasts for this page only
  }
}

interface PostSchedulePickerProps {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
  /** Shown under the time field (the composer's validation) */
  problem?: ScheduleProblem | null;
  disabled?: boolean;
  /** Only the date and time (changing a scheduled post's time), no "now" option */
  timeOnly?: boolean;
}

export function PostSchedulePicker({ value, onChange, problem, disabled, timeOnly }: PostSchedulePickerProps) {
  const { t, lang } = useLanguage();
  const texts = t.community;
  const id = useId();
  const locale = lang === 'ar' ? 'ar' : 'en';
  // The zone, its names and the bounds come from the browser (never rendered on the server)
  const [ready, setReady] = useState(false);
  const [pickingZone, setPickingZone] = useState(false);
  const [zoneQuery, setZoneQuery] = useState('');
  useEffect(() => {
    setReady(true);
    // Only an empty pick moves to the saved zone: a stored time keeps its instant
    if (!value.zone && !value.local) {
      const saved = readSavedZone();
      if (saved && saved !== browserZone()) {
        // Keep the same wall-clock time, read in the saved zone
        onChange({ ...value, zone: saved });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zone = zoneOf(value);
  const now = Date.now();
  const bounds = ready
    ? { min: dateToWallTime(new Date(now + SCHEDULE_MIN_LEAD_MS), zone).slice(0, 10), max: dateToWallTime(new Date(now + SCHEDULE_MAX_LEAD_MS), zone).slice(0, 10) }
    : null;

  const zoneOptions = useMemo<AutocompleteOption[]>(() => {
    if (!pickingZone) return [];
    const at = new Date();
    return allZones().map((z) => ({
      id: z,
      label: zoneLabel(z, locale, at),
      // The zone id (a code, Latin in both languages); the Latin city name only on the English page
      // The city and zone id in both languages (Latin, in an isolate in Arabic): the city is how people search
      subtitle: z === 'UTC' ? 'UTC' : `${zoneCity(z)} · ${z}`,
      keywords: [z, zoneCity(z), zoneName(z, 'en', at), zoneName(z, 'ar', at)],
      selected: z === zone,
    }));
  }, [pickingZone, locale, zone]);

  const problemText = problem === 'too_soon' ? texts.scheduleTooSoon : problem === 'too_far' ? texts.scheduleTooFar : problem === 'required' ? texts.scheduleRequired : '';
  const showTime = timeOnly || value.later;
  const [date = '', time = ''] = value.local.split('T');
  const describedBy = `${id}-zone${problem ? ` ${id}-problem` : ''}`;

  return (
    <div className="space-y-3" data-testid="post-schedule">
      {!timeOnly && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium md:text-base mb-2">{texts.publishTiming}</legend>
          <OptionCard
            name={`${id}-when`}
            checked={!value.later}
            onSelect={() => onChange({ ...value, later: false })}
            disabled={disabled}
            inputTestId="post-schedule-now"
            title={texts.publishNowOption}
            help={texts.publishNowHelp}
          />
          <OptionCard
            name={`${id}-when`}
            checked={value.later}
            onSelect={() => onChange({ ...value, later: true })}
            disabled={disabled}
            inputTestId="post-schedule-later"
            title={texts.scheduleOption}
            help={texts.scheduleHelp}
          />
        </fieldset>
      )}
      {showTime && (
        <div className="space-y-3">
          <fieldset className="space-y-2" data-testid="post-schedule-datetime">
            <legend className="mb-2 text-sm font-medium">{texts.scheduleDateTime}</legend>
            {/* Two fields, so each value shows in full in the composer's narrow side column */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <LocalizedDatePicker
                value={date}
                onChange={(next) => onChange({ ...value, local: joinLocal(next, time) })}
                locale={locale}
                label={texts.scheduleDate}
                placeholder={texts.pickDate}
                prevMonthLabel={texts.previousMonth}
                nextMonthLabel={texts.nextMonth}
                min={bounds?.min}
                max={bounds?.max}
                disabled={disabled}
                invalid={Boolean(problem)}
                describedBy={describedBy}
                testId="post-schedule-date"
              />
              <div className="space-y-1">
                <span id={`${id}-time-label`} className="block text-xs text-muted-foreground">{texts.scheduleTime}</span>
                <Select value={time || undefined} onValueChange={(next) => onChange({ ...value, local: joinLocal(date, next) })} disabled={disabled}>
                  <SelectTrigger
                    aria-labelledby={`${id}-time-label`}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={describedBy}
                    className="h-10 w-full gap-2"
                    data-testid="post-schedule-time"
                  >
                    {/* One clock at the start, the value, and the trigger's chevron at the end edge */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <SelectValue placeholder={texts.pickTime} />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timeSlots(time).map((slot) => (
                      <SelectItem key={slot} value={slot} data-testid={`post-schedule-time-${slot}`}>
                        {formatSlot(slot, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </fieldset>

          <div id={`${id}-zone`} className="space-y-2 text-sm" data-testid="post-schedule-zone">
            {/* The same two rows in both languages: the label with Change, then the zone (it wraps on its own row) */}
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">{texts.timezoneLabel}</span>
              <button
                type="button"
                onClick={() => { setPickingZone((p) => !p); setZoneQuery(''); }}
                aria-expanded={pickingZone}
                disabled={disabled}
                className="ms-auto rounded px-1 text-[var(--fanous-color-link)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-link)]"
                data-testid="post-schedule-zone-change"
              >
                {texts.changeTimezone}
              </button>
            </div>
            {ready && <p className="m-0 font-medium [text-wrap:balance]" data-testid="post-schedule-timezone">{zoneLabel(zone, locale)}</p>}
            {pickingZone && (
              <Autocomplete
                value={zoneQuery}
                onValueChange={setZoneQuery}
                options={zoneOptions}
                emptyOptions={zoneOptions.slice(0, 8)}
                maxOptions={30}
                mode="inline"
                label={texts.searchTimezone}
                inputProps={{ type: 'search', placeholder: texts.searchTimezone, autoFocus: true }}
                inputClassName="f-input w-full py-2 text-sm"
                // Clear of the zone name above: the field's focus ring draws outside it
                className="w-full !mt-4"
                onSelect={(option) => {
                  saveZone(option.id);
                  // The same wall-clock time, now read in the new zone
                  onChange({ ...value, zone: option.id });
                  setPickingZone(false);
                }}
                testId="post-schedule-zone-search"
              />
            )}
          </div>
          {problem && (
            <p id={`${id}-problem`} role="alert" className="text-sm text-[var(--fanous-color-error-text)]" data-testid="post-schedule-error">
              {problemText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { isoDay };
