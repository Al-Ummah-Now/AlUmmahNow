/**
 * Number formats of the Delivery comparison page, with the locale's digits
 * (Arabic-Indic in Arabic, like the charts). Server and client safe.
 */
import { chartLocale, formatDuration } from '@al-ummah/shared-types';

export interface DeliveryFormats {
  integer: (v: number) => string;
  decimal: (v: number) => string;
  seconds: (v: number) => string;
  duration: (seconds: number) => string;
  percent: (ratio: number) => string;
  kbps: (v: number) => string;
  hours: (v: number) => string;
  gb: (v: number) => string;
  usd: (v: number) => string;
  /** A day key (2026-11-11) as "11 Nov" */
  day: (day: string) => string;
  /** A minute key (2026-11-11T10:41) as "10:41", in UTC (same on the server and in the browser) */
  time: (minute: string) => string;
}

export function deliveryFormats(locale: string): DeliveryFormats {
  const loc = chartLocale(locale);
  const integer = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
  const seconds = new Intl.NumberFormat(loc, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 2 });
  const kbps = new Intl.NumberFormat(loc, { style: 'unit', unit: 'kilobit-per-second', unitDisplay: 'short', maximumFractionDigits: 0 });
  const hours = new Intl.NumberFormat(loc, { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 });
  const gb = new Intl.NumberFormat(loc, { style: 'unit', unit: 'gigabyte', unitDisplay: 'short', maximumFractionDigits: 2 });
  const usdWhole = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const usdCents = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdFine = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 });
  const day = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  return {
    integer: (v) => integer.format(v),
    decimal: (v) => decimal.format(v),
    seconds: (v) => seconds.format(v),
    duration: formatDuration(locale),
    percent: (v) => percent.format(v),
    kbps: (v) => kbps.format(v),
    hours: (v) => hours.format(v),
    gb: (v) => gb.format(v),
    // Whole dollars from $10, cents below, and two significant digits under a cent
    usd: (v) => (v >= 10 ? usdWhole : v >= 0.01 || v === 0 ? usdCents : usdFine).format(v),
    time: (m) => {
      const date = new Date(`${m}:00Z`);
      return Number.isNaN(date.getTime()) ? m : time.format(date);
    },
    day: (d) => {
      const date = new Date(`${d}T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? d : day.format(date);
    },
  };
}
