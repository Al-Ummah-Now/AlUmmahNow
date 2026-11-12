import { expect, type Page } from '@playwright/test';
import { channelsOf, findQaLecturesChannel, listChannelPlaylists } from './channel-content';
import { ensureSeedVideos, SEED_TITLES } from './e2e-videos';
import type { AuthUser } from './auth-state';

/**
 * Every routable page of apps/web/src/app/[locale] (plus /en|ar/live and the
 * 404 page), resolved to real QA data. Used by the axe-on-every-page spec and
 * the visual snapshot spec so both stay in sync with the route inventory in
 * docs/testing/UI-TEST-PLAN.md.
 *
 * Pages owned by other workstreams (search v2, explore, library,
 * notifications, @handle URLs) are scanned by their own specs.
 */

export type CatalogRole = 'anon' | AuthUser;

export interface CatalogPage {
  /** Stable id used in test titles and snapshot names */
  id: string;
  /** Path without the locale prefix, e.g. "/channels" */
  path: string;
  role: CatalogRole;
}

export interface CatalogData {
  lectureVideoId: string;
  lecturesChannelId: string;
  playlistId: string | null;
  singleChannelId: string;
  singleSeedVideoId: string;
}

const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');

let cached: CatalogData | null = null;

/** Resolves the QA ids the catalog paths need (cached per worker) */
export async function loadCatalogData(): Promise<CatalogData> {
  if (cached) return cached;
  const res = await fetch(`${API_URL}/api/videos?limit=100`);
  expect(res.ok, 'GET /api/videos').toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string; title: string }> };
  const lecture = (body.data ?? [])
    .filter((v) => v.title.startsWith('QA Lecture'))
    .sort((a, b) => a.title.localeCompare(b.title))[0];
  if (!lecture) throw new Error('No "QA Lecture" seed video on QA (run the Seed QA workflow)');
  const channel = await findQaLecturesChannel();
  const playlists = await listChannelPlaylists(channel.id);
  const seed = await ensureSeedVideos('single');
  cached = {
    lectureVideoId: lecture.id,
    lecturesChannelId: channel.id,
    playlistId: playlists[0]?.id ?? null,
    singleChannelId: channelsOf('single').main.id,
    singleSeedVideoId: seed[SEED_TITLES.singleVideo].id,
  };
  return cached;
}

/**
 * The catalog ids from a spec file's own data (local stack): its own creator's public video,
 * channel and playlist (own-public-video.ts) and the single user's own Studio video
 * (own-studio-videos.ts). No seed, no other run's rows.
 */
export function catalogFromOwnData(own: { videoId: string; channelId: string; playlistId: string | null; singleVideoId: string }): CatalogData {
  return {
    lectureVideoId: own.videoId,
    lecturesChannelId: own.channelId,
    playlistId: own.playlistId,
    singleChannelId: channelsOf('single').main.id,
    singleSeedVideoId: own.singleVideoId,
  };
}

/** The full page inventory for a role */
export function catalog(d: CatalogData): CatalogPage[] {
  const ch = `/settings/channel/${d.singleChannelId}`;
  const pages: CatalogPage[] = [
    // Public pages (anonymous)
    { id: 'home', path: '', role: 'anon' },
    { id: 'videos', path: '/videos', role: 'anon' },
    { id: 'channels', path: '/channels', role: 'anon' },
    { id: 'channel', path: `/channels/${d.lecturesChannelId}`, role: 'anon' },
    { id: 'channel-videos-tab', path: `/channels/${d.lecturesChannelId}?tab=videos`, role: 'anon' },
    { id: 'channel-community-tab', path: `/channels/${d.lecturesChannelId}?tab=community`, role: 'anon' },
    { id: 'watch', path: `/video/${d.lectureVideoId}`, role: 'anon' },
    { id: 'watch-legacy', path: `/video?vid=${d.lectureVideoId}`, role: 'anon' },
    { id: 'watch-none', path: '/video', role: 'anon' },
    { id: 'sections', path: '/sections', role: 'anon' },
    { id: 'live', path: '/live', role: 'anon' },
    { id: 'privacy', path: '/settings/privacy', role: 'anon' },
    { id: 'not-found', path: '/this-page-does-not-exist', role: 'anon' },
    // Sign-in prompts for signed-out visitors
    { id: 'upload-anon', path: '/upload', role: 'anon' },
    { id: 'profile-anon', path: '/profile', role: 'anon' },
    { id: 'profile-create-anon', path: '/profile/create', role: 'anon' },
    { id: 'settings-anon', path: '/settings', role: 'anon' },
    { id: 'feed-anon', path: '/subscriptions', role: 'anon' },
    { id: 'subscriptions-anon', path: '/subscriptions/manage', role: 'anon' },
    { id: 'history-anon', path: '/history', role: 'anon' },
    { id: 'analytics-anon', path: '/studio/go/analytics', role: 'anon' },
    // Signed-in creator (profile + one channel)
    { id: 'upload', path: '/upload', role: 'single' },
    // Creator pages live in Studio (old paths 301 there)
    { id: 'dashboard', path: '/studio/go/content/videos', role: 'single' },
    { id: 'scheduled', path: '/studio/go/content/videos?status=scheduled&view=calendar', role: 'single' },
    { id: 'video-edit', path: `/studio/video/${d.singleSeedVideoId}/edit`, role: 'single' },
    { id: 'studio-dashboard', path: '/studio', role: 'single' },
    { id: 'profile', path: '/profile', role: 'single' },
    { id: 'profile-edit', path: '/profile/edit', role: 'single' },
    { id: 'settings', path: '/settings', role: 'single' },
    { id: 'upload-defaults', path: '/settings/upload-defaults', role: 'single' },
    { id: 'channel-settings', path: ch, role: 'single' },
    { id: 'channel-settings-edit', path: `${ch}/edit`, role: 'single' },
    { id: 'channel-settings-tabs', path: `${ch}/tabs`, role: 'single' },
    { id: 'channel-settings-sections', path: `${ch}/sections`, role: 'single' },
    { id: 'channel-settings-playlists', path: `${ch}/playlists`, role: 'single' },
    { id: 'channel-settings-community', path: `${ch}/community`, role: 'single' },
    { id: 'channel-settings-community-new', path: `${ch}/community/new`, role: 'single' },
    { id: 'channel-settings-videos', path: `/studio/${d.singleChannelId}/content/videos`, role: 'single' },
    { id: 'analytics', path: '/studio/go/analytics', role: 'single' },
    { id: 'feed', path: '/subscriptions', role: 'single' },
    { id: 'subscriptions', path: '/subscriptions/manage', role: 'single' },
    { id: 'history', path: '/history', role: 'single' },
    { id: 'channels-signed-in', path: '/channels', role: 'single' },
    // Profile without a channel
    { id: 'upload-no-channel', path: '/upload', role: 'none' },
    { id: 'analytics-no-channel', path: '/studio/go/analytics', role: 'none' },
  ];
  if (d.playlistId) pages.push({ id: 'playlist', path: `/playlist/${d.playlistId}`, role: 'anon' });
  return pages;
}

/** Ids of the catalog pages that get visual snapshots (key pages) */
export const VISUAL_PAGE_IDS = ['home', 'channels', 'channel', 'watch', 'not-found', 'privacy', 'upload', 'dashboard'] as const;

/**
 * Opens a catalog page and waits until it has settled: the document has a
 * <main> landmark (or the 404 heading), late client fetches are done and
 * skeleton placeholders are gone.
 */
export async function openCatalogPage(page: Page, locale: 'en' | 'ar', entry: CatalogPage) {
  const response = await page.goto(`/${locale}${entry.path}`, { waitUntil: 'domcontentloaded' });
  expect(response, `navigation to ${entry.path}`).not.toBeNull();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  // Every page renders inside the root layout's skip-link target
  await expect(page.locator('#page-content')).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15000 }).catch(() => undefined);
}

/**
 * The site theme the visual baselines and the axe scan are taken in: production's (Lantern).
 * QA's active theme is one admin setting shared by every concurrent run and may change at any
 * time, so these suites never depend on it: every page ships the CSS of all built-in themes and
 * `<html data-theme>` picks one, so the page is switched in place. The other themes are covered,
 * without screenshots, by the Theme visibility contrast check (e2e/themes, all four themes,
 * light and dark, on these same pages).
 */
export const REFERENCE_THEME = 'lantern';

/**
 * Pins the reference theme and the colour scheme on the open page, the way the server
 * (data-theme) and next-themes (the dark/light class and color-scheme) set them, then waits
 * for styles and fonts to settle.
 */
export async function pinReferenceTheme(page: Page, colorScheme: 'light' | 'dark') {
  await page.evaluate(
    async ([theme, mode]) => {
      const html = document.documentElement;
      html.dataset.theme = theme;
      html.classList.toggle('dark', mode === 'dark');
      html.classList.toggle('light', mode === 'light');
      html.style.colorScheme = mode;
      await document.fonts.ready;
      // Two frames: the restyle is applied and painted
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    [REFERENCE_THEME, colorScheme] as const,
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', REFERENCE_THEME);
}

/** Opens a catalog page (openCatalogPage) and pins the reference theme in the given colour scheme. */
export async function openCatalogPageInReferenceTheme(page: Page, locale: 'en' | 'ar', entry: CatalogPage, colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme });
  await openCatalogPage(page, locale, entry);
  await pinReferenceTheme(page, colorScheme);
}
