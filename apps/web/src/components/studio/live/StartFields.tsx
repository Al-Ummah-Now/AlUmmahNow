'use client';

/** A start, in the creator's time zone. */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { toLocalDateInput, toLocalTimeInput } from '@/components/videoEdit/schedule-inputs';
import { useLanguage } from '@/hooks/useLanguage';

export interface StartValue {
  date: string;
  time: string;
}

export const NO_START: StartValue = { date: '', time: '' };

export const startOf = (iso?: string | null): StartValue => {
  const at = iso ? new Date(iso) : null;
  return at && Number.isFinite(at.getTime()) ? { date: toLocalDateInput(at), time: toLocalTimeInput(at) } : NO_START;
};

/** `empty` when neither is set, `bad` when it is half set or not to come. */
export function readStart(value: StartValue, now = Date.now()): { iso: string } | 'empty' | 'incomplete' | 'past' {
  if (!value.date && !value.time) return 'empty';
  const at = value.date && value.time ? new Date(`${value.date}T${value.time}`) : null;
  if (!at || !Number.isFinite(at.getTime())) return 'incomplete';
  return at.getTime() <= now ? 'past' : { iso: at.toISOString() };
}

export function StartFields({ value, onChange, legend, required = false }: { value: StartValue; onChange: (value: StartValue) => void; legend?: string; required?: boolean }) {
  const { t } = useLanguage();
  const text = t.studio.live.apps;
  const id = useId();
  return (
    <fieldset className="grid gap-1" data-testid="studio-live-start">
      {legend && <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>}
      <div className="flex flex-wrap gap-3">
        <div className="grid min-w-36 flex-1 gap-1 sm:max-w-44">
          <label htmlFor={`${id}-date`} className="text-sm text-foreground">{text.date}</label>
          <Input id={`${id}-date`} type="date" required={required} min={toLocalDateInput(new Date())} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} data-testid="studio-live-date" />
        </div>
        <div className="grid min-w-32 flex-1 gap-1 sm:max-w-40">
          <label htmlFor={`${id}-time`} className="text-sm text-foreground">{text.time}</label>
          <Input id={`${id}-time`} type="time" required={required} value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} data-testid="studio-live-time" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{text.startHelp}</p>
    </fieldset>
  );
}
