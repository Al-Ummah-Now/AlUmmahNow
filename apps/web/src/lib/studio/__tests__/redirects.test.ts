import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_REDIRECTS } from '../redirects';
import { checkPath } from '../nav';

const APP = path.join(__dirname, '../../../app/[locale]');

/** The page file a path would render, matching dynamic segments like [channelId]. */
function pageExists(segments: string[]): boolean {
  let dir = APP;
  for (const segment of segments) {
    if (fs.existsSync(path.join(dir, segment))) {
      dir = path.join(dir, segment);
      continue;
    }
    const dynamic = fs.readdirSync(dir).find((name) => /^\[[^.\]]+\]$/.test(name));
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, 'page.tsx'));
}

const channelRedirects = STUDIO_REDIRECTS.filter((r) => r.source.includes('/settings/channel/'));

describe('channel settings redirects (spec §6.2)', () => {
  it('moves every old channel settings page, permanently', () => {
    expect(channelRedirects.length).toBeGreaterThanOrEqual(12);
    for (const r of channelRedirects) expect(r.statusCode).toBe(301);
  });

  it.each(channelRedirects.map((r) => [r.source, r.destination]))('%s lands on a Studio page the owner opens (%s)', (_source, destination) => {
    const [pathname] = destination.split('?');
    const segments = pathname.replace('/:locale/studio/:id/', '').split('/').map((s) => (s.startsWith(':') ? 'x1' : s));
    expect(checkPath('owner', segments).status).toBe('ok');
    expect(pageExists(['studio', 'x', ...segments])).toBe(true);
  });

  it('matches /playlists/new before a playlist id', () => {
    const sources = STUDIO_REDIRECTS.map((r) => r.source);
    expect(sources.indexOf('/:locale(en|ar)/settings/channel/:id/playlists/new')).toBeLessThan(sources.indexOf('/:locale(en|ar)/settings/channel/:id/playlists/:playlistId'));
  });

  it('leaves the account settings pages where they are', () => {
    for (const page of ['/settings', '/settings/upload-defaults', '/settings/privacy', '/settings/channel-invites']) {
      expect(STUDIO_REDIRECTS.some((r) => r.source === `/:locale(en|ar)${page}`)).toBe(false);
    }
  });

  it('removed the old pages', () => {
    expect(fs.existsSync(path.join(APP, 'settings/channel'))).toBe(false);
  });
});
