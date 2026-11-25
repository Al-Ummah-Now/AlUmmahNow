/**
 * The videos admin's setting help (wiki AUN-ADMIN-HELP), read on the server. The content is
 * packages/admin-help/content/videos-admin; the "?" popovers get only their brief text
 * (`tipsFor`), the help guide gets whole entries (`helpArea`, `helpAreas`).
 */
import { fillTemplate } from '@al-ummah/shared-types';
import { VIDEOS_ADMIN_HELP } from '../../../../../packages/admin-help/content/videos-admin/index.ts';
import { localizeArea, tipData, type Fill } from '../../../../../packages/admin-help/src/content.ts';
import type { HelpTipData, LocalizedArea } from '../../../../../packages/admin-help/src/types.ts';
import type { Locale } from '@/i18n/config';

export type { HelpTipData, LocalizedArea, LocalizedEntry } from '../../../../../packages/admin-help/src/types.ts';

/** `{#n}` in the locale's digits (٠–٩ in Arabic) through the shared formatter. */
const fill: Fill = (locale, text) => fillTemplate(locale, text);

export function helpAreaSlugs(): string[] {
  return VIDEOS_ADMIN_HELP.map((a) => a.area);
}

export function helpAreas(locale: Locale): LocalizedArea[] {
  return VIDEOS_ADMIN_HELP.map((a) => localizeArea(a, locale, fill));
}

export function helpArea(locale: Locale, slug: string): LocalizedArea | null {
  const area = VIDEOS_ADMIN_HELP.find((a) => a.area === slug);
  return area ? localizeArea(area, locale, fill) : null;
}

/** The popover text for one or more areas' settings. */
export function tipsFor(locale: Locale, ...areas: string[]): Record<string, HelpTipData> {
  return tipData(VIDEOS_ADMIN_HELP.filter((a) => areas.includes(a.area)), locale, fill);
}
