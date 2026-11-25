/**
 * Localizing help entries. Framework-free and dependency-free: the admin passes its own number
 * formatter (`fill`) so `{#123}` comes out in the locale's digits, ٠–٩ in Arabic.
 */
import type { HelpArea, HelpEntry, HelpLocale, HelpTipData, LocalizedArea, LocalizedEntry } from './types.ts';

/** Fills `{#n}` numbers (and anything else the admin's template filler handles). */
export type Fill = (locale: HelpLocale, text: string) => string;

/** The guide's URL for an entry, in the app that hosts the guide. */
export function helpHref(area: string, anchor: string, base = '/help'): string {
  return `${base}/${area}#${anchor}`;
}

export function localizeEntry(area: HelpArea, entry: HelpEntry, locale: HelpLocale, fill: Fill, base = '/help'): LocalizedEntry {
  const f = (t: { en: string; ar: string }) => fill(locale, t[locale]);
  return {
    id: entry.id,
    area: area.area,
    anchor: entry.anchor,
    href: helpHref(area.area, entry.anchor, base),
    label: f(entry.label),
    summary: f(entry.summary),
    tipCaution: entry.tipCaution ? f(entry.tipCaution) : null,
    what: f(entry.what),
    changes: f(entry.changes),
    options: (entry.options ?? []).map((o) => ({ value: o.value, label: f(o.label), text: f(o.text), default: !!o.default })),
    default: entry.default ? f(entry.default) : null,
    range: entry.range ? f(entry.range) : null,
    cautions: entry.cautions.map(f),
    rules: entry.rules.map((r) => ({ text: f(r), source: r.source ?? null })),
    approval: !!entry.approval,
  };
}

export function localizeArea(area: HelpArea, locale: HelpLocale, fill: Fill, base = '/help'): LocalizedArea {
  return {
    area: area.area,
    route: area.route,
    title: fill(locale, area.title[locale]),
    intro: fill(locale, area.intro[locale]),
    settings: area.settings.map((e) => localizeEntry(area, e, locale, fill, base)),
  };
}

/** Only what the popover shows, for the page's settings (keeps the browser bundle small). */
export function tipData(areas: readonly HelpArea[], locale: HelpLocale, fill: Fill, base = '/help'): Record<string, HelpTipData> {
  const out: Record<string, HelpTipData> = {};
  for (const area of areas) {
    for (const e of area.settings) {
      out[e.id] = {
        id: e.id,
        label: fill(locale, e.label[locale]),
        summary: fill(locale, e.summary[locale]),
        tipCaution: e.tipCaution ? fill(locale, e.tipCaution[locale]) : null,
        href: helpHref(area.area, e.anchor, base),
      };
    }
  }
  return out;
}
