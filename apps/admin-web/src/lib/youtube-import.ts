/**
 * Videos admin → Platform settings → YouTube import (wiki AUN-YT-IMPORT):
 * the form's rules, kept free of server-only imports so they are unit tested.
 * The client secret is write only: it is typed here, sent once to admin-api,
 * sealed by api-videos and never shown again (the view says only whether one
 * is present, where from and who last replaced it).
 */
import { isGoogleClientId, isGoogleClientSecret, YT_SCOPE_CAPTIONS, YT_SCOPE_READONLY, type YoutubeImportSettingsView } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

export interface YoutubeImportForm {
  enabled: boolean;
  clientId: string;
}

/** What a save sends: only the changed fields. */
export type YoutubeImportPatch = Partial<YoutubeImportForm>;

export const formOf = (view: YoutubeImportSettingsView): YoutubeImportForm => ({ enabled: view.enabled, clientId: view.clientId });

/** The client id field's error (empty: none). An empty id is allowed (clears it) but cannot be on. */
export function clientIdError(form: YoutubeImportForm): MessageKey | null {
  const id = form.clientId.trim();
  if (!isGoogleClientId(id)) return 'youtubeImport.errorClientId';
  if (form.enabled && !id) return 'youtubeImport.errorClientIdNeeded';
  return null;
}

/** Only the fields that changed, trimmed; null when nothing did. */
export function settingsPatch(view: YoutubeImportSettingsView, form: YoutubeImportForm): YoutubeImportPatch | null {
  const patch: Partial<YoutubeImportForm> = {};
  if (form.enabled !== view.enabled) patch.enabled = form.enabled;
  const id = form.clientId.trim();
  if (id !== view.clientId) patch.clientId = id;
  return Object.keys(patch).length ? patch : null;
}

/** The client secret field's error (empty: none). An empty field just means nothing to save yet. */
export function clientSecretError(value: string): MessageKey | null {
  if (!value.trim()) return 'youtubeImport.errorSecretEmpty';
  return isGoogleClientSecret(value) ? null : 'youtubeImport.errorSecret';
}

/**
 * A URL in pieces that end at each "/" ("https://", "videos.api…net/", "api/", …, "callback"):
 * the page lets a long URL wrap only between pieces, never inside a word ("youtube-import").
 */
export function urlSegments(url: string): string[] {
  return url.match(/[^/]*\/+|[^/]+$/g) ?? [url];
}

/**
 * Whether leaving the secret field shows its check. An empty field stays quiet (its "paste it
 * first" message is for Save): otherwise the line it adds moves Cancel down under the pointer
 * between press and release, and the click that leaves the field misses Cancel.
 */
export function secretChecksOnBlur(value: string): boolean {
  return value.trim().length > 0;
}

/** The friendly message for a failed secret save (never the raw error). */
export function secretSaveErrorMessage(result: { status: number; code?: string }): MessageKey {
  if (result.status === 401) return 'errors.notAuthenticated';
  if (result.status === 403) return 'youtubeImport.errorForbidden';
  if (result.status === 400) return 'youtubeImport.errorSecret';
  return 'youtubeImport.secretSaveFailed';
}

/** The Secrets Store secret api-videos falls back to when none was set here, from its redirect URI's host. */
export function secretNameFor(redirectUri: string): string {
  let host = '';
  try {
    host = new URL(redirectUri).hostname;
  } catch {
    host = '';
  }
  if (/(^|\.)qa\./.test(host)) return 'google-oauth-client-secret-qa';
  if (/(^|\.)stage\./.test(host)) return 'google-oauth-client-secret-stage';
  return 'google-oauth-client-secret';
}

export type YoutubeImportReadiness = 'ready' | 'off' | 'needsClientId' | 'needsSecret';

/** Why creators can or cannot connect yet (the badge). */
export function readiness(view: YoutubeImportSettingsView): YoutubeImportReadiness {
  if (!view.clientId) return 'needsClientId';
  if (!view.secretPresent) return 'needsSecret';
  if (!view.enabled) return 'off';
  return 'ready';
}

/** What each scope is for (the scopes list). */
export function scopePurpose(scope: string): MessageKey {
  if (scope === YT_SCOPE_READONLY) return 'youtubeImport.scopeReadonly';
  if (scope === YT_SCOPE_CAPTIONS) return 'youtubeImport.scopeCaptions';
  return 'youtubeImport.scopeOther';
}

/** The friendly message for a failed save (never the raw error). */
export function saveErrorMessage(result: { status: number; code?: string }): MessageKey {
  if (result.status === 401) return 'errors.notAuthenticated';
  if (result.status === 403) return 'youtubeImport.errorForbidden';
  if (result.status === 400) return 'youtubeImport.errorClientId';
  return 'youtubeImport.saveFailed';
}
