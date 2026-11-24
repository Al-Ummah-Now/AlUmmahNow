/**
 * Admin setting help (wiki AUN-ADMIN-HELP): the content format.
 *
 * One JSON file per settings area (`content/<app>/<area>.json`), one entry per setting, every text
 * in English and Arabic. The "?" popover shows only `label`, `summary` and `tipCaution`; the admin
 * help guide shows the whole entry. Both read the same entry, so they cannot say different things.
 * Native admin apps vendor the same files at build time.
 *
 * Numbers in text are written `{#123}` so Arabic shows ٠–٩ through the shared formatter. A literal
 * value the admin types (a version, a key, a JSON value) goes in backticks: it is shown as code,
 * left to right, exactly as written.
 */

export const HELP_LOCALES = ['en', 'ar'] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];

/** A text in both languages. */
export interface Bilingual {
  en: string;
  ar: string;
}

/** A law, store rule or provider policy the setting touches: a fact, with its official source. */
export interface HelpRule extends Bilingual {
  source?: string;
}

export interface HelpOption {
  value: string;
  label: Bilingual;
  text: Bilingual;
  default?: boolean;
}

export interface HelpEntry {
  /** Stable id, e.g. `platform.downloads.perDay`: the "?" button and the coverage check use it */
  id: string;
  /** The anchor on the area's guide page */
  anchor: string;
  label: Bilingual;
  /** The popover's text: one or two short sentences */
  summary: Bilingual;
  /** Optional one-line caution shown in the popover, only for a real risk */
  tipCaution?: Bilingual;
  what: Bilingual;
  /** What happens when it changes: who is affected and how fast */
  changes: Bilingual;
  options?: HelpOption[];
  /** Free inputs: the default and allowed range (choices mark their own default) */
  default?: Bilingual;
  range?: Bilingual;
  cautions: Bilingual[];
  rules: HelpRule[];
  /** True when an approval workflow rule (AUN-WORKFLOWS) can hold a change to it */
  approval?: boolean;
  /** Repo-relative files that render the setting */
  sources: string[];
}

export interface HelpArea {
  area: string;
  /** The admin page the settings are on */
  route: string;
  title: Bilingual;
  intro: Bilingual;
  settings: HelpEntry[];
}

/** One language of an entry, as the popover and the guide render it. */
export interface LocalizedOption {
  value: string;
  label: string;
  text: string;
  default: boolean;
}

export interface LocalizedEntry {
  id: string;
  area: string;
  anchor: string;
  href: string;
  label: string;
  summary: string;
  tipCaution: string | null;
  what: string;
  changes: string;
  options: LocalizedOption[];
  default: string | null;
  range: string | null;
  cautions: string[];
  rules: { text: string; source: string | null }[];
  approval: boolean;
}

/** What the "?" popover needs, and nothing more (it ships to the browser). */
export interface HelpTipData {
  id: string;
  label: string;
  summary: string;
  tipCaution: string | null;
  href: string;
}

export interface LocalizedArea {
  area: string;
  route: string;
  title: string;
  intro: string;
  settings: LocalizedEntry[];
}

/** Popover length limits (characters, either language): the popover stays brief (owner, 2026-11-24). */
export const SUMMARY_MAX = 220;
export const TIP_CAUTION_MAX = 130;
