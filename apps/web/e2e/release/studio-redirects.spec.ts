/**
 * The channel settings pages moved into Studio for good (#772, docs/specs/CREATOR-STUDIO.md §6.2):
 * every old /settings/channel/{id}/… URL answers 301 with the Studio page, in English and Arabic,
 * and keeps its query string. The redirects are static (next.config.ts), so no account or channel
 * is needed: an id that names nothing is redirected the same way. Account settings stay put.
 */
import { expect, test } from '@playwright/test';
import { target } from './targets';
import { fetchRetry } from './net';

const ID = 'e2e-redirect-check';
const PLAYLIST = 'e2e-playlist';

/** Old path under /settings/channel/{id} → Studio path under /studio/{id} */
const MOVED: Array<[old: string, studio: string]> = [
  ['', '/dashboard'],
  ['/videos', '/content/videos'],
  ['/edit', '/customisation/profile'],
  ['/sections', '/customisation/layout?view=sections'],
  ['/tabs', '/customisation/layout?view=tabs'],
  ['/playlists', '/playlists'],
  ['/playlists/new', '/playlists/new'],
  [`/playlists/${PLAYLIST}`, `/playlists/${PLAYLIST}`],
  ['/community', '/content/posts'],
  ['/community/new', '/content/posts/new'],
  ['/team', '/settings/permissions'],
  ['/members', '/settings/permissions'],
];

async function location(path: string): Promise<{ status: number; location: string }> {
  const res = await fetchRetry(`${target().web}${path}`, { redirect: 'manual' });
  const to = new URL(res.headers.get('location') ?? '', target().web);
  return { status: res.status, location: to.pathname + to.search };
}

test.describe('Release: old channel settings pages redirect into Studio', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`every moved page answers 301 with its Studio page (${locale})`, async () => {
      for (const [old, studio] of MOVED) {
        const from = `/${locale}/settings/channel/${ID}${old}`;
        const got = await location(from);
        expect(got.status, `${from} answers 301`).toBe(301);
        expect(got.location, `${from} goes to Studio`).toBe(`/${locale}/studio/${ID}${studio}`);
      }
    });
  }

  test('a query string is kept', async () => {
    const got = await location(`/en/settings/channel/${ID}/playlists/${PLAYLIST}?job=j1`);
    expect(got.status).toBe(301);
    expect(got.location).toBe(`/en/studio/${ID}/playlists/${PLAYLIST}?job=j1`);
  });

  test('account settings stay where they are', async () => {
    for (const path of ['/en/settings', '/en/settings/upload-defaults', '/ar/settings/privacy']) {
      const res = await fetchRetry(`${target().web}${path}`, { redirect: 'manual' });
      expect(res.status, `${path} is not moved`).not.toBe(301);
    }
  });
});
