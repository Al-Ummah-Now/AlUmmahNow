/**
 * Move from YouTube (wiki AUN-YT-IMPORT), end to end on the local stack: a creator opens Studio →
 * Content → Move from YouTube, is refused by Google once (the friendly error, Connect again), then
 * connects with captions, picks every video and the playlist, chooses a Takeout zip, reviews the
 * matches (2 by the id in the file name, 1 by title) and imports. The API then has the videos with
 * YouTube's titles, dates, visibility and schedule, the thumbnail, the ar + en captions and the
 * playlist in YouTube's order.
 *
 * Local stack only: Google and YouTube are the stack's fake (scripts/local-stack/fake-google.ts,
 * docs/testing/LOCAL-STACK.md), whose fixture channel UCaunFixtureChannel0001 has
 *   AUNytPUB001  public, ar + en captions, a maxres thumbnail
 *   AUNytUNL002  unlisted, made for kids
 *   AUNytPRV003  private, scheduled 30 days ahead
 *   PLaunFixture0001 "Fixture playlist": AUNytPUB001, AUNytUNL002
 * The fake's consent mode is stack-wide, so both consents run in this one test.
 *
 * Own data: the user, channel, Takeout zip and everything the import makes are this test's, and
 * removed afterwards (the videos, the playlist, the import; the run-user erasure takes the rest).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { onLocalStack } from './builders';
import { CONTROL, createChannelInMenu } from './media-providers';
import { buildZip } from './takeout-zip';

test.use({ trace: 'off', video: 'off' });

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const TAKEOUT_DIR = 'Takeout/YouTube and YouTube Music';

/** The fake's fixture videos and the Takeout file each one comes in (all 16:9 clips, like YouTube's thumbnail). */
const VIDEOS = {
  public: { ytId: 'AUNytPUB001', title: 'Fixture public talk', file: 'Fixture public talk [AUNytPUB001].mp4', clip: 'e2e-sample.mp4', publishedAt: '2024-03-01T09:00:00Z' },
  kids: { ytId: 'AUNytUNL002', title: 'Fixture unlisted kids video', file: 'Fixture unlisted kids video.mp4', clip: 'e2e-sample-40s.mp4', publishedAt: '2024-06-15T12:00:00Z' },
  scheduled: { ytId: 'AUNytPRV003', title: 'Fixture scheduled video', file: 'Fixture scheduled video [AUNytPRV003].mp4', clip: 'e2e-sample-90s.mp4', publishedAt: '2026-01-10T08:00:00Z' },
} as const;
const PLAYLIST = { ytId: 'PLaunFixture0001', title: 'Fixture playlist' };

interface ImportItem { id: string; ytVideoId: string; videoId: string | null; state: string; thumbnail: string; captions: string }
interface ImportPlaylist { ytPlaylistId: string; playlistId: string | null; state: string }
interface ImportDetail { import: { id: string; status: string }; items: ImportItem[]; playlists: ImportPlaylist[] }
interface OwnVideo {
  id: string;
  title?: string;
  isPublic?: boolean;
  isUnlisted?: boolean;
  thumbnailType?: string;
  scheduledPublishDate?: string;
  importedFrom?: { platform: string; videoId: string; publishedAt: string | null; madeForKids: boolean; importId: string };
}

/**
 * The Takeout zip: the three videos, and a videos.csv that lists the two named with their id.
 * The kids video is left out of the csv, as in an export made before it was uploaded, so the
 * wizard matches it by its title alone (the csv would otherwise count as an id match).
 */
function takeoutZip(): string {
  const csv = ['Video ID,Approx Duration (ms),Video Title (Original)', `${VIDEOS.public.ytId},4000,${VIDEOS.public.title}`, `${VIDEOS.scheduled.ytId},4000,${VIDEOS.scheduled.title}`].join('\n');
  const zip = buildZip([
    ...Object.values(VIDEOS).map((v) => ({ name: `${TAKEOUT_DIR}/videos/${v.file}`, data: new Uint8Array(fs.readFileSync(path.join(FIXTURES, v.clip))) })),
    { name: `${TAKEOUT_DIR}/video metadata/videos.csv`, data: `${csv}\n` },
  ]);
  const file = path.join(os.tmpdir(), `takeout-e2e-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.zip`);
  fs.writeFileSync(file, zip);
  return file;
}

async function fakeGoogle(action: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__fake/google/${action}`, { method: 'POST' });
  expect(res.ok, `fake Google ${action}: ${res.status}`).toBe(true);
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { result?: T; data?: T } & T;
  return (body.result ?? body.data ?? body) as T;
}

async function importDetail(user: WebUser, importId: string): Promise<ImportDetail> {
  return json<ImportDetail>(await apiFetch(user, `/api/youtube-import/${importId}`));
}

async function ownVideo(user: WebUser, id: string, channelId: string): Promise<OwnVideo> {
  const body = await json<{ video?: OwnVideo } & OwnVideo>(await apiFetch(user, `/api/videos/${id}`, { headers: { channelId } }));
  return body.video ?? body;
}

test.describe('Move from YouTube', () => {
  test.skip(!onLocalStack(), 'local stack only: Google and YouTube are the stack\'s fake (scripts/local-stack/fake-google.ts)');

  test('a refused consent explains itself; then a Takeout import brings videos, captions, thumbnail and playlist', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    const user = await signUpOnWeb(page, 'rel-yt-import');
    await createProfile(user);
    await grantCreatorTier(user);
    const channelId = await createChannelInMenu(page, user, `Release E2E YouTube ${Date.now().toString(36)}`);
    const zip = takeoutZip();
    let importId = '';
    let detail: ImportDetail | null = null;

    try {
      await test.step('Studio → Content → Move from YouTube', async () => {
        await fakeGoogle('reset');
        await page.goto(`${target().web}/en/studio/${encodeURIComponent(channelId)}/content/videos`);
        await page.getByTestId('studio-tab-youtube').click();
        await expect(page).toHaveURL(/\/en\/studio\/[^/]+\/content\/youtube/);
        await expect(page.getByTestId('yt-connect')).toBeVisible({ timeout: 30000 });
      });

      await test.step('Google refuses: the friendly error and Connect again', async () => {
        await fakeGoogle('consent?mode=deny');
        await page.getByTestId('yt-connect-button').click();
        await expect(page.getByTestId('yt-connect-error')).toHaveText(/Google didn.t give access, so nothing was imported/, { timeout: 30000 });
        await expect(page.getByTestId('yt-connect-button')).toHaveText(/Connect again/);
        // The error left the address: a reload does not show it again
        expect(new URL(page.url()).search).toBe('');
      });

      await test.step('connect with captions and pick every video and the playlist', async () => {
        await fakeGoogle('consent?mode=allow');
        await page.getByTestId('yt-captions').check();
        await page.getByTestId('yt-connect-button').click();
        await expect(page.getByTestId('yt-pick')).toBeVisible({ timeout: 90000 });
        await expect(page.getByTestId('yt-video-row')).toHaveCount(3);
        await page.getByTestId('yt-select-all').click();
        await page.getByTestId('yt-tab-playlists').click();
        await expect(page.getByTestId('yt-playlist-row')).toHaveCount(1);
        await expect(page.getByTestId('yt-playlist-row')).toContainText(PLAYLIST.title);
        await page.getByTestId('yt-playlist-recreate').check();
        await page.getByTestId('yt-pick-next').click();

        const status = await json<{ import: { id: string } | null }>(await apiFetch(user, `/api/youtube-import/status?channelId=${encodeURIComponent(channelId)}`));
        importId = status.import?.id ?? '';
        expect(importId, 'the connection made an import').not.toBe('');
      });

      await test.step('choose the Takeout zip and review the matches', async () => {
        await page.getByTestId('yt-file-input').setInputFiles(zip);
        await expect(page.getByTestId('yt-picked-file')).toHaveCount(1, { timeout: 30000 });
        await expect(page.getByTestId('yt-csv-state')).toBeVisible();
        await page.getByTestId('yt-files-next').click();
        await expect(page.getByTestId('yt-review')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('yt-group-byId').getByTestId('yt-review-row')).toHaveCount(2);
        await expect(page.getByTestId('yt-group-byTitle').getByTestId('yt-review-row')).toHaveCount(1);
        await expect(page.getByTestId('yt-group-byTitle')).toContainText(VIDEOS.kids.title);
        await expect(page.getByTestId('yt-left-out')).toHaveCount(0);
      });

      await test.step('import: every video uploads and turns ready', async () => {
        await page.getByTestId('yt-start').click();
        await expect(page.getByTestId('yt-progress-row')).toHaveCount(3, { timeout: 30000 });
        // Bytes from the zip, through TUS; the fake Bunny encodes a finished upload in seconds
        for (const row of await page.getByTestId('yt-progress-row').all()) {
          await expect(row).toHaveAttribute('data-phase', /^(processing|ready)$/, { timeout: 180000 });
        }
        await expect
          .poll(async () => {
            detail = await importDetail(user, importId);
            return detail.items.filter((i) => i.state === 'ready').length;
          }, { message: 'all three items ready', timeout: 180000 })
          .toBe(3);
      });

      await test.step('the finishing steps: thumbnail, captions, playlist', async () => {
        // yt-finalize runs a minute after each upload; the playlist follows once every video has its own
        await expect
          .poll(async () => {
            detail = await importDetail(user, importId);
            const pub = detail.items.find((i) => i.ytVideoId === VIDEOS.public.ytId);
            const pl = detail.playlists.find((p) => p.ytPlaylistId === PLAYLIST.ytId);
            return `thumbnail ${pub?.thumbnail} captions ${pub?.captions} playlist ${pl?.state}`;
          }, { message: 'the thumbnail, captions and playlist are done', timeout: 300000, intervals: [5000] })
          .toBe('thumbnail done captions done playlist done');
      });

      const items = new Map((detail as ImportDetail | null)?.items.map((i) => [i.ytVideoId, i]) ?? []);
      const videoIdOf = (ytId: string) => {
        const id = items.get(ytId)?.videoId;
        expect(id, `${ytId} has its video`).toBeTruthy();
        return id!;
      };

      await test.step('the videos carry YouTube\'s titles, dates, visibility and schedule', async () => {
        const now = Date.now();
        const pub = await ownVideo(user, videoIdOf(VIDEOS.public.ytId), channelId);
        const kids = await ownVideo(user, videoIdOf(VIDEOS.kids.ytId), channelId);
        const scheduled = await ownVideo(user, videoIdOf(VIDEOS.scheduled.ytId), channelId);

        for (const [video, fixture] of [[pub, VIDEOS.public], [kids, VIDEOS.kids], [scheduled, VIDEOS.scheduled]] as const) {
          expect(video.title).toBe(fixture.title);
          expect(video.importedFrom?.platform).toBe('youtube');
          expect(video.importedFrom?.videoId).toBe(fixture.ytId);
          expect(video.importedFrom?.importId).toBe(importId);
          expect(Date.parse(video.importedFrom?.publishedAt ?? ''), `${fixture.ytId} keeps YouTube's publish date`).toBe(Date.parse(fixture.publishedAt));
        }

        expect(pub.isPublic).toBe(true);
        expect(pub.thumbnailType, 'YouTube\'s thumbnail is the custom thumbnail').toBe('custom');

        expect(kids.isUnlisted, 'unlisted on YouTube, unlisted here').toBe(true);
        expect(kids.isPublic).toBeFalsy();
        expect(kids.importedFrom?.madeForKids).toBe(true);

        expect(scheduled.isPublic).toBeFalsy();
        expect(scheduled.isUnlisted).toBeFalsy();
        const at = Date.parse(scheduled.scheduledPublishDate ?? '');
        expect(at, 'scheduled about 30 days ahead, like on YouTube').toBeGreaterThan(now + 29 * 86_400_000);
        expect(at).toBeLessThan(now + 31 * 86_400_000);
      });

      await test.step('AUNytPUB001 has its ar and en captions (not the automatic track)', async () => {
        const subtitles = await json<{ tracks: Array<{ language: string }> }>(await apiFetch(user, `/api/videos/${videoIdOf(VIDEOS.public.ytId)}/subtitles`, { headers: { channelId } }));
        expect(subtitles.tracks.map((t) => t.language).sort()).toEqual(['ar', 'en']);
      });

      await test.step('"Fixture playlist" holds the two videos in YouTube\'s order', async () => {
        const playlistId = (detail as ImportDetail | null)?.playlists.find((p) => p.ytPlaylistId === PLAYLIST.ytId)?.playlistId;
        expect(playlistId, 'the playlist was made').toBeTruthy();
        const playlist = await json<{ title?: string; videos?: string[] }>(await apiFetch(user, `/api/playlists/${playlistId}`, { headers: { channelId } }));
        expect(playlist.title).toBe(PLAYLIST.title);
        expect(playlist.videos).toEqual([videoIdOf(VIDEOS.public.ytId), videoIdOf(VIDEOS.kids.ytId)]);
      });
    } finally {
      fs.rmSync(zip, { force: true });
      if (importId) {
        const last = await importDetail(user, importId).catch(() => detail);
        for (const item of last?.items ?? []) {
          if (item.videoId) await apiFetch(user, `/api/videos/${item.videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
        }
        for (const p of last?.playlists ?? []) {
          if (p.playlistId) await apiFetch(user, `/api/playlists/${p.playlistId}`, { method: 'DELETE', headers: { channelId } });
        }
        // A finished import has already given its Google token back; a running one is stopped here
        await apiFetch(user, `/api/youtube-import/${importId}/cancel`, { method: 'POST' });
      }
      await fakeGoogle('reset').catch(() => undefined);
    }
  });
});
