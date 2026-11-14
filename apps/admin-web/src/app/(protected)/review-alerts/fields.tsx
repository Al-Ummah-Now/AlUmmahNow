'use client';

/**
 * The rota's own fields: a type-to-search time zone picker (live results by city, country or
 * zone name, with the UTC offset) and a 24-hour time field written in the page's language
 * (the browser's time input follows the device's language and clock, "05:00 PM" on an Arabic page).
 */
import { useId, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { matchZones, zoneOption, zoneOptions } from './timezones';

/** Shown at once; typing narrows the rest. */
const MAX_SHOWN = 60;

export function TimeZoneField({ value, zones, onChange, testId }: { value: string; zones: string[]; onChange: (zone: string) => void; testId?: string }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null: not searching, the box shows the chosen zone
  const [active, setActive] = useState(0);
  const current = useMemo(() => zoneOption(locale, value), [locale, value]);
  const open = query !== null;
  const all = useMemo(() => (open ? zoneOptions(locale, zones) : []), [open, locale, zones]);
  const matches = useMemo(() => (open ? matchZones(all, query ?? '') : []), [open, all, query]);
  const shown = matches.slice(0, MAX_SHOWN);
  const optionId = (i: number) => `${ids}-tz-${i}`;
  const display = `${current.city} (${current.offset})`;

  const close = () => {
    setQuery(null);
    setActive(0);
  };
  const choose = (zone: string) => {
    onChange(zone);
    close();
  };
  const move = (next: number) => {
    const i = Math.max(0, Math.min(shown.length - 1, next));
    setActive(i);
    listRef.current?.querySelector(`#${CSS.escape(optionId(i))}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col text-sm sm:w-80" data-testid={testId}>
      <label htmlFor={`${ids}-tz`} className="mb-1 text-fg">
        {t('reviewAlerts.timeZone')}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${ids}-tz`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${ids}-tz-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown.length ? optionId(active) : undefined}
          aria-describedby={`${ids}-tz-current`}
          autoComplete="off"
          spellCheck={false}
          dir="auto"
          className={`${fieldClass} min-h-11 w-full`}
          placeholder={t('reviewAlerts.timeZoneSearch')}
          value={open ? (query ?? '') : display}
          onFocus={() => {
            setQuery('');
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onBlur={close}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(active + 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(active - 1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (shown[active]) choose(shown[active].id);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
              inputRef.current?.blur();
            }
          }}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <span id={`${ids}-tz-current`} className="sr-only">
          {current.id}
        </span>
        <div
          hidden={!open}
          className="absolute start-0 top-full z-30 mt-1 w-full min-w-72 overflow-hidden rounded border border-border bg-surface shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul ref={listRef} id={`${ids}-tz-list`} role="listbox" aria-label={t('reviewAlerts.timeZone')} className="max-h-80 overflow-auto py-1" data-testid={testId ? `${testId}-list` : undefined}>
            {shown.map((z, i) => (
              <li
                key={z.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(z.id)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? 'bg-surface-2 outline outline-2 -outline-offset-2 outline-focus' : ''}`}
                data-zone={z.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-fg" dir="auto">
                    {z.city}
                    {z.id === value && <span className="ms-2 rounded-full border border-border bg-surface-2 px-2 text-xs text-fg-muted">{t('autocomplete.current')}</span>}
                  </span>
                  {z.name && (
                    <span className="truncate text-xs text-fg-muted" dir="auto">
                      {z.name}
                    </span>
                  )}
                </span>
                <bdi dir="ltr" className="shrink-0 text-xs text-fg-muted">
                  {z.offset}
                </bdi>
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-fg-muted">{t('reviewAlerts.timeZoneNone')}</p>}
          {matches.length > MAX_SHOWN && <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">{t('reviewAlerts.timeZoneMore')}</p>}
          <p role="status" aria-live="polite" className="sr-only">
            {open ? t('autocomplete.count', { count: matches.length }) : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

/** "HH:MM", 24 h, two selects; a minute off the 5-minute steps stays selectable. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage();
  const ids = useId();
  const [h = '00', m = '00'] = value.split(':');
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  const select = `${fieldClass} min-h-11 px-2`;
  return (
    <div className="flex flex-col text-sm">
      <span id={`${ids}-label`} className="mb-1 text-xs text-fg-muted">
        {label}
      </span>
      {/* Hours then minutes, left to right in both languages, as times are written */}
      <div role="group" aria-labelledby={`${ids}-label`} dir="ltr" className="flex items-center gap-1">
        <select className={select} aria-label={`${label}: ${t('reviewAlerts.hour')}`} value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
          {HOURS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="text-fg-muted">
          :
        </span>
        <select className={select} aria-label={`${label}: ${t('reviewAlerts.minute')}`} value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
          {minutes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
