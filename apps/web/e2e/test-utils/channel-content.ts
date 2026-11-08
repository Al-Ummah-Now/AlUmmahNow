import * as fs from 'fs';
import * as path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';
import { readAccount, type AuthUser } from './auth-state';

/**
 * API helpers for the channel specs (50-55): set up and clean up channel
 * content (sections, playlists, community posts, subscriptions, tab config)
 * owned by the E2E users, through api-videos with the stored access token.
 *
 * Writes only ever target the E2E users' own channels. qa-creator's seeded
 * channels ("Al Ummah Now QA — Lectures") are read-only fixtures.
 */

export const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');

/** qa-creator's seeded public channel name prefix (read-only) */
export const QA_LECTURES_CHANNEL_NAME = 'Al Ummah Now QA — Lectures';

export const TEMP_PREFIX = 'E2E Temp';

/** Unique, recognisable name for content a test creates */
export function tempName(label: string): string {
  return `${TEMP_PREFIX} ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface UserChannels {
  userId: string;
  main: { id: string; name: string };
  other?: { id: string; name: string };
}

export function channelsOf(user: AuthUser): UserChannels {
  const { userId, channels } = readAccount(user);
  const main = channels.find((c) => c.isMain) ?? channels[0];
  if (!main) throw new Error(`E2E user "${user}" has no channel`);
  const other = channels.find((c) => c.id !== main.id);
  return {
    userId,
    main: { id: main.id, name: main.name ?? '' },
    other: other ? { id: other.id, name: other.name ?? '' } : undefined,
  };
}

/** fetch with a few retries on network-level failures (QA occasionally resets connections) */
async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Raw API call as `user`, acting as `channelId` (when given) */
export async function apiAs<T = unknown>(
  user: AuthUser,
  method: string,
  path: string,
  options: { channelId?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
  const { accessToken } = readAccount(user);
  const res = await fetchRetry(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.channelId ? { channelId: options.channelId } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  return { status: res.status, body: body as T };
}

/** Anonymous GET */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetchRetry(`${API_URL}${path}`);
  expect(res.ok, `GET ${path} -> ${res.status}`).toBe(true);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public read-only fixtures
// ---------------------------------------------------------------------------

export interface PublicChannel {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  userId: string;
}

/** qa-creator's seeded Lectures channel (public videos, a playlist, posts) */
export async function findQaLecturesChannel(): Promise<PublicChannel> {
  const body = await apiGet<{ data?: PublicChannel[] }>('/api/channels?limit=200');
  const channel = (body.data ?? []).find((c) => c.name === QA_LECTURES_CHANNEL_NAME);
  if (!channel) throw new Error(`Seed channel "${QA_LECTURES_CHANNEL_NAME}" not found (run the Seed QA workflow)`);
  return channel;
}

export interface PublicPlaylist {
  id: string;
  name: string;
  title: string;
  videos: string[];
  channelId: string;
}

export async function listChannelPlaylists(channelId: string): Promise<PublicPlaylist[]> {
  const body = await apiGet<{ data?: PublicPlaylist[] }>(`/api/playlists?channelId=${channelId}&limit=100`);
  return body.data ?? [];
}

export async function listPublicChannelVideos(channelId: string): Promise<Array<{ id: string; title: string }>> {
  const body = await apiGet<{ data?: Array<{ id: string; title: string }> }>(`/api/channels/${channelId}/videos?limit=20`);
  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface SectionRow {
  id: string;
  title: string;
  type: string;
  position: number;
}

export async function listSections(user: AuthUser, channelId: string): Promise<SectionRow[]> {
  const { body } = await apiAs<{ result?: { sections?: SectionRow[] } }>(user, 'GET', `/api/channels/${channelId}/sections`, { channelId });
  return [...(body.result?.sections ?? [])].sort((a, b) => a.position - b.position);
}

export async function createSection(
  user: AuthUser,
  channelId: string,
  data: { type: string; title: string; videoIds?: string[]; playlistId?: string; playlistIds?: string[] }
): Promise<SectionRow> {
  const { status, body } = await apiAs<{ result?: { section?: SectionRow } }>(user, 'POST', `/api/channels/${channelId}/sections`, {
    channelId,
    body: data,
  });
  expect(status, 'create section').toBeLessThan(300);
  return body.result!.section!;
}

/** Deletes the channel's sections whose title starts with `prefix` (default: every temp section) */
export async function deleteSectionsTitled(user: AuthUser, channelId: string, prefix = TEMP_PREFIX) {
  for (const section of await listSections(user, channelId)) {
    if (section.title?.startsWith(prefix)) {
      await apiAs(user, 'DELETE', `/api/channels/${channelId}/sections/${section.id}`, { channelId });
    }
  }
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function createPlaylist(
  user: AuthUser,
  channelId: string,
  data: { title: string; description?: string; isPublic?: boolean; videoIds?: string[] }
): Promise<{ id: string }> {
  const { status, body } = await apiAs<{ result?: { playlist?: { id: string } } }>(user, 'POST', '/api/playlists', {
    channelId,
    body: { title: data.title, description: data.description, isPublic: data.isPublic ?? true },
  });
  expect(status, 'create playlist').toBeLessThan(300);
  const id = body.result!.playlist!.id;
  for (const videoId of data.videoIds ?? []) {
    const added = await apiAs(user, 'POST', `/api/playlists/${id}/videos`, { channelId, body: { videoId } });
    expect(added.status, 'add video to playlist').toBeLessThan(300);
  }
  return { id };
}

export async function deletePlaylistQuietly(user: AuthUser, channelId: string, playlistId: string) {
  await apiAs(user, 'DELETE', `/api/playlists/${playlistId}`, { channelId }).catch(() => undefined);
}

/** Deletes the channel's playlists whose title starts with `prefix` */
export async function deletePlaylistsTitled(user: AuthUser, channelId: string, prefix: string) {
  const { body } = await apiAs<{ data?: PublicPlaylist[] }>(user, 'GET', `/api/playlists?channelId=${channelId}&limit=100`);
  for (const playlist of body.data ?? []) {
    if ((playlist.title || playlist.name || '').startsWith(prefix)) {
      await deletePlaylistQuietly(user, channelId, playlist.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Community posts
// ---------------------------------------------------------------------------

interface PostRow {
  id: string;
  content?: string;
  type: string;
  likes: number;
  viewerHasLiked?: boolean;
  poll?: { question: string };
  quiz?: { question: string };
}

export async function listPosts(user: AuthUser, channelId: string, viewerChannelId?: string): Promise<PostRow[]> {
  const { body } = await apiAs<{ posts?: PostRow[] }>(user, 'GET', `/api/community/channels/${channelId}/posts?limit=50`, {
    channelId: viewerChannelId,
  });
  return body.posts ?? [];
}

export async function createTextPost(user: AuthUser, channelId: string, content: string): Promise<PostRow> {
  const { status, body } = await apiAs<{ post?: PostRow }>(user, 'POST', `/api/community/channels/${channelId}/posts`, {
    channelId,
    body: { type: 'text', content, visibility: 'public', commentsEnabled: true },
  });
  expect(status, 'create post').toBeLessThan(300);
  return body.post!;
}

/** Deletes the channel's posts whose text/question contains `marker` */
export async function deletePostsContaining(user: AuthUser, channelId: string, marker: string) {
  for (const post of await listPosts(user, channelId, channelId)) {
    const text = `${post.content ?? ''} ${post.poll?.question ?? ''} ${post.quiz?.question ?? ''}`;
    if (text.includes(marker)) {
      await apiAs(user, 'DELETE', `/api/community/channels/${channelId}/posts/${post.id}`, { channelId });
    }
  }
}

export async function unlikePost(user: AuthUser, viewerChannelId: string, postChannelId: string, postId: string) {
  await apiAs(user, 'DELETE', `/api/community/channels/${postChannelId}/posts/${postId}/like`, { channelId: viewerChannelId });
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function subscriptionStatus(
  user: AuthUser,
  viewerChannelId: string,
  channelId: string
): Promise<{ isSubscribed: boolean; subscriberCount: number }> {
  const { body } = await apiAs<{ result?: { isSubscribed: boolean; subscriberCount: number } }>(
    user,
    'GET',
    `/api/channels/${channelId}/subscriptions/status`,
    { channelId: viewerChannelId }
  );
  return body.result ?? { isSubscribed: false, subscriberCount: 0 };
}

export async function ensureUnsubscribed(user: AuthUser, viewerChannelId: string, channelId: string) {
  if ((await subscriptionStatus(user, viewerChannelId, channelId)).isSubscribed) {
    await apiAs(user, 'DELETE', `/api/channels/${channelId}/subscriptions`, { channelId: viewerChannelId });
  }
}

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

export interface TabConfig {
  defaultTab: string;
  tabs: Array<{ id: string; visible: boolean; position: number; name?: string; nameLocalized?: Record<string, string>; type?: string }>;
}

export async function getTabConfig(channelId: string): Promise<TabConfig> {
  return apiGet<TabConfig>(`/api/channels/${channelId}/tabs`);
}

export async function putTabConfig(user: AuthUser, channelId: string, config: TabConfig) {
  const { status } = await apiAs(user, 'PUT', `/api/channels/${channelId}/tabs`, {
    channelId,
    body: {
      defaultTab: config.defaultTab,
      tabs: config.tabs.map(({ id, visible, position }) => ({ id, visible, position })),
    },
  });
  expect(status, 'restore tab config').toBeLessThan(300);
}

/** Visible tab ids in display order */
export function visibleTabIds(config: TabConfig): string[] {
  return [...config.tabs].filter((t) => t.visible).sort((a, b) => a.position - b.position).map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Cross-worker lock
// ---------------------------------------------------------------------------

const LOCK_ROOT = path.join(__dirname, '..', '.auth');
const LOCK_STALE_MS = 3 * 60 * 1000;

/**
 * Runs `fn` while holding a named lock shared by all workers and projects of
 * the run. Used where tests flip one shared piece of state (a subscription,
 * a channel's tab configuration) that parallel projects would otherwise race on.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>, waitMs = 150_000): Promise<T> {
  const dir = path.join(LOCK_ROOT, `.lock-${name}`);
  fs.mkdirSync(LOCK_ROOT, { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // lock released meanwhile
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock "${name}"`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Clicks until `done` holds: the first click of a client page can land
 * before hydration, which silently drops it.
 */
export async function clickUntil(target: Locator, done: () => Promise<void>, timeout = 30000) {
  let clicked = false;
  await expect(async () => {
    // Re-check first: a slow earlier click may have landed, and clicking a toggle again would undo it
    if (clicked) {
      try {
        await done();
        return;
      } catch {
        // not done yet: click again
      }
    }
    await target.click({ timeout: 3000 });
    clicked = true;
    await done();
  }).toPass({ timeout });
}

/** Fills an input, re-filling if a hydration re-render dropped the value */
export async function fillStable(input: Locator, value: string) {
  await expect(async () => {
    if ((await input.inputValue()) !== value) await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

/**
 * Moves a dnd-kit sortable item one step down with the keyboard sensor:
 * Space picks it up, ArrowDown moves it, Space drops it. dnd-kit measures
 * between steps, so each key waits for the drag state to settle.
 */
export async function keyboardMoveDown(page: Page, handle: Locator) {
  // A click (below the 8px pointer-drag threshold) focuses the handle reliably
  await expect(async () => {
    await handle.click();
    await expect(handle).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
}

/** Horizontal centre of an element */
export async function centerX(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box.x + box.width / 2;
}

export async function expectRtl(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
}
