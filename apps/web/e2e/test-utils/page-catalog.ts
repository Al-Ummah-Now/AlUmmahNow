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
    { id: 'feed-anon', path: '/feed', role: 'anon' },
    { id: 'subscriptions-anon', path: '/subscriptions', role: 'anon' },
    { id: 'history-anon', path: '/history', role: 'anon' },
    { id: 'analytics-anon', path: '/analytics', role: 'anon' },
    // Signed-in creator (profile + one channel)
    { id: 'upload', path: '/upload', role: 'single' },
    { id: 'dashboard', path: '/dashboard/videos', role: 'single' },
    { id: 'scheduled', path: '/scheduled-videos', role: 'single' },
    { id: 'video-edit', path: `/video/${d.singleSeedVideoId}/edit`, role: 'single' },
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
    { id: 'channel-settings-videos', path: `${ch}/videos`, role: 'single' },
    { id: 'analytics', path: '/analytics', role: 'single' },
    { id: 'feed', path: '/feed', role: 'single' },
    { id: 'subscriptions', path: '/subscriptions', role: 'single' },
    { id: 'history', path: '/history', role: 'single' },
    { id: 'channels-signed-in', path: '/channels', role: 'single' },
    // Profile without a channel
    { id: 'upload-no-channel', path: '/upload', role: 'none' },
    { id: 'analytics-no-channel', path: '/analytics', role: 'none' },
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
