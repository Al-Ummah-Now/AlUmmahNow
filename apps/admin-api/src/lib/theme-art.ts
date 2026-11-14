/**
 * The art of custom themes published before the art part existed (ThemeStore.publishedCss builds it on
 * the first read of their theme.css). A version whose art cannot be built is served without it and
 * flagged on the admin Errors page, with Retry ("theme-art" in lib/errors-actions.ts) that builds it
 * again; the item closes itself once a read or a Retry has built it.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { logger } from './logger';
import { ThemeStore } from './themePackages';

/** Needs-action item key of one version's art */
export const themeArtItemKey = (id: string, version: string) => `theme-art:${id}@${version}`;

/** Flags the version on the Errors page. Never throws. */
export async function flagThemeArtFailure(env: AdminBindings, id: string, version: string, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `The art of theme ${id}@${version} could not be built: ${reason}`.slice(0, 500),
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: themeArtItemKey(id, version),
      source: 'admin-job',
      title: 'Theme art not built',
      itemType: 'theme-package',
      itemId: `${id}@${version}`,
      itemUrl: `/site-theme/themes/${encodeURIComponent(id)}`,
      retry: { kind: 'builtin', handler: 'theme-art', args: { id, version } },
      retryLabel: 'Build again',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[Themes] Could not flag the art failure on the Errors page', { id, version, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Closes the version's item once its art is built. Never throws. */
export async function resolveThemeArtItem(env: AdminBindings, id: string, version: string): Promise<void> {
  try {
    const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
    await enqueueIngest(env, { v: 1, events: [], resolved: [themeArtItemKey(id, version)], trustedRetry: true, receivedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[Themes] Could not resolve the art item', { id, version, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Reads a version's CSS, building its art if it has none, and flags or clears the admin item to match.
 * `defer` runs the reporting after the response (ctx.waitUntil); tests and Retry await it.
 */
export async function themeCssWithArt(env: AdminBindings, id: string, version: string, defer: (p: Promise<unknown>) => void = (p) => void p) {
  const out = await new ThemeStore(env.REPORTS_DB, env.theme_packages).publishedCss(id, version);
  if (out?.art === 'failed') defer(flagThemeArtFailure(env, id, version, out.error ?? 'unknown error'));
  if (out?.art === 'added') defer(resolveThemeArtItem(env, id, version));
  return out;
}
