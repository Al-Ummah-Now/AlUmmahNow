'use client';

/**
 * When a community post goes live (Story 29.4): now, or at a date and time in the viewer's own time
 * zone, 5 minutes to a year ahead (the API's window, api-videos lib/post-schedule.ts). `value` is the
 * chosen time as an ISO string, or null for "now"; an invalid time reports its problem instead.
 */

import { useEffect, useId, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { OptionCard } from '@/components/ui/OptionCard';
import { useLanguage } from '@/hooks/useLanguage';

export const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000;
export const SCHEDULE_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ScheduleProblem = 'required' | 'too_soon' | 'too_far';

/** The problem with a local `datetime-local` value, or null when it can be scheduled. */
export function scheduleProblem(local: string, now = Date.now()): ScheduleProblem | null {
  if (!local) return 'required';
  const t = new Date(local).getTime();
  if (Number.isNaN(t)) return 'required';
  if (t < now + SCHEDULE_MIN_LEAD_MS) return 'too_soon';
  if (t > now + SCHEDULE_MAX_LEAD_MS) return 'too_far';
  return null;
}

/** A Date as a `datetime-local` value (local time, minutes). */
export function toLocalInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** A post's scheduled time in the viewer's language and zone. */
export function formatScheduledAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale === 'ar' ? 'ar' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface ScheduleState {
  /** True when "Schedule for later" is picked */
  later: boolean;
  /** The `datetime-local` value */
  local: string;
}

export function scheduleStateFrom(iso?: string | null): ScheduleState {
  return iso ? { later: true, local: toLocalInput(new Date(iso)) } : { later: false, local: '' };
}

/** The ISO time to send, or null for "publish now". */
export function scheduledIso(state: ScheduleState): string | null {
  return state.later && state.local ? new Date(state.local).toISOString() : null;
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
  const { t } = useLanguage();
  const texts = t.community;
  const id = useId();
  const [zone, setZone] = useState('');
  // Bounds and the zone come from the browser (never rendered on the server, so no hydration mismatch)
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const now = Date.now();
    setBounds({ min: toLocalInput(new Date(now + SCHEDULE_MIN_LEAD_MS)), max: toLocalInput(new Date(now + SCHEDULE_MAX_LEAD_MS)) });
  }, []);
  const problemText = problem === 'too_soon' ? texts.scheduleTooSoon : problem === 'too_far' ? texts.scheduleTooFar : problem === 'required' ? texts.scheduleRequired : '';
  const showTime = timeOnly || value.later;

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
        <div className="space-y-2">
          <label htmlFor={`${id}-time`} className="block text-sm font-medium">
            {texts.scheduleDateTime}
          </label>
          <div className="relative">
            <Calendar className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id={`${id}-time`}
              type="datetime-local"
              value={value.local}
              onChange={(e) => onChange({ ...value, local: e.target.value })}
              min={bounds?.min}
              max={bounds?.max}
              disabled={disabled}
              required
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-zone${problem ? ` ${id}-problem` : ''}`}
              data-testid="post-schedule-datetime"
              className="h-10 w-full rounded-md border border-input bg-transparent ps-10 pe-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p id={`${id}-zone`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {zone && (
              <span data-testid="post-schedule-timezone">
                {texts.scheduleTimezone.split('{zone}')[0]}
                <bdi dir="ltr">{zone}</bdi>
                {texts.scheduleTimezone.split('{zone}')[1] ?? ''}
              </span>
            )}
          </p>
          {problem && (
            <p id={`${id}-problem`} role="alert" className="text-sm text-destructive" data-testid="post-schedule-error">
              {problemText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
