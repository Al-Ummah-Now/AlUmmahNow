/**
 * Library (Story 29.6) and notification center (Story 29.10) strings.
 *
 * Kept in their own module and spread into EN_TRANSLATIONS / AR_TRANSLATIONS
 * so these features touch the shared translation files as little as possible.
 */

import {
  LIBRARY_AR,
  LIBRARY_EN,
  NOTIFICATION_CENTER_AR,
  NOTIFICATION_CENTER_EN,
  type LibraryTranslations,
  type NotificationCenterTranslations,
} from '@al-ummah/shared-types';

// Values live in shared-types so the API translation seed (api-videos
// translationsSync) and the web static fallback stay identical.
export { LIBRARY_AR, LIBRARY_EN, NOTIFICATION_CENTER_AR, NOTIFICATION_CENTER_EN };
export type { LibraryTranslations, NotificationCenterTranslations };

/** Fill `{name}` placeholders. */
export function fillTemplate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] !== undefined ? String(params[name]) : ''));
}
