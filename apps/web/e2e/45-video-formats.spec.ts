import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import { userApi } from './test-utils/e2e-videos';
import { expectUploadSuccess, gotoUpload, trackUploads, uploadUi } from './test-utils/upload';
import { deleteVideosTitled, tempName } from './test-utils/upload-studio';
import { formatClips, refusedFiles, type FormatClip } from './test-utils/video-clips';

/**
 * The files the upload forms accept (#1938). Every iPhone video is a MOV, which a browser reports
 * as video/quicktime; the form used to compare the type with "video/mov" and refused it, and
 * refused AVI (video/x-msvideo) and any file the system gave no type for. One small clip per
 * accepted format (test-utils/video-clips.ts), each with the type browsers really report and with
 * none, goes through the single form, the batch form and drag and drop; what the browser sent to
 * the server (the TUS metadata) and what the server stored (upload-status) are checked too.
 * Files that are not on the list are refused with a message naming the list.
 *
 * The local stack fakes Bunny and the transcoder, so this suite says nothing about encoding.
 * Each test names its videos with its own "E2E Temp" prefix and deletes them afterwards.
 */

test.use({ storageState: AUTH_STATE.single });

const FORMATS_EN = 'MP4, M4V, MOV, WebM, MKV, AVI';
const FORMATS_AR = 'MP4، M4V، MOV، WebM، MKV، AVI';

let prefix = '';
const prefixes: string[] = [];

test.beforeEach(() => {
  prefix = tempName('formats');
  prefixes.push(prefix);
});

test.afterEach(async ({ page }) => {
  await page.close().catch(() => undefined);
  await deleteVideosTitled('single', prefix, { passes: 3, waitMs: 3000 });
});

test.afterAll(async () => {
  for (const p of prefixes) await deleteVideosTitled('single', p);
});

const asFile = (clip: FormatClip, mimeType: string) => ({ name: clip.name, mimeType, buffer: clip.buffer });
/** The clips named "<prefix> <format>.<ext>", so every video has its own title */
const namedClips = (stem: string): FormatClip[] => formatClips(stem).map((c) => ({ ...c, name: c.name.replace(`${stem}.`, `${stem} ${c.label}.`) }));

async function openBatch(page: Page, locale: 'en' | 'ar' = 'en') {
  await gotoUpload(page, locale);
  await page.getByTestId('upload-mode-batch').click();
  await expect(page.getByTestId('batch-dropzone')).toBeVisible();
}

/** A DataTransfer of files built in the page, as a drag from the desktop gives */
async function dropped(page: Page, files: Array<{ name: string; mimeType: string; bytes?: number }>) {
  return page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes ?? 1024)], f.name, { type: f.mimeType }));
    return dt;
  }, files);
}

/** The upload-status the server keeps for a video: the type it was told */
async function storedFormat(videoId: string): Promise<string | undefined> {
  const u = userApi('single');
  const res = await u.api.get<{ originalFormat?: string }>(`/api/videos/${videoId}/upload-status`, { token: u.token, channelId: u.channelIds[0] });
  return res.data.originalFormat;
}

test.describe('Video formats - single upload', () => {
  for (const clip of formatClips('fmt')) {
    for (const reported of clip.reported) {
      test(`FMT-S ${clip.label} reported as "${reported || '(no type)'}" is accepted, sent as ${clip.sent} and stored`, async ({ page }) => {
        const ui = uploadUi(page);
        const tracker = trackUploads(page);
        await gotoUpload(page, 'en');
        await ui.fileInput.setInputFiles(asFile(clip, reported));
        await expect(ui.details).toBeVisible();
        await expect(ui.pageError).toHaveCount(0);
        await expect(ui.fileName).toHaveText(clip.name);

        await ui.titleEn.fill(`${prefix} ${clip.label} ${reported || 'none'}`);
        await ui.submit.click();
        await expectUploadSuccess(page);

        expect(tracker.videoIds.size).toBe(1);
        const [videoId] = [...tracker.videoIds];
        // The type in the TUS metadata (what Bunny is told) and the type the record keeps
        const create = tracker.tusRequests().find((r) => r.method === 'POST');
        const filetype = /filetype ([A-Za-z0-9+/=]+)/.exec(create?.headers['upload-metadata'] ?? '')?.[1];
        expect(filetype && Buffer.from(filetype, 'base64').toString('utf8')).toBe(clip.sent);
        await expect.poll(() => storedFormat(videoId!), { timeout: 30_000 }).toBe(clip.sent);
      });
    }
  }

  test('FMT-S2 refuses what is not on the list, with a message that names the list', async ({ page }) => {
    const ui = uploadUi(page);
    await gotoUpload(page, 'en');
    for (const file of refusedFiles(prefix)) {
      await ui.fileInput.setInputFiles(file);
      await expect(ui.pageError).toBeVisible();
      await expect(ui.pageError).toContainText(FORMATS_EN);
      await expect(ui.details).toBeHidden();
      await expect(ui.dropzone).toBeVisible();
      await page.getByTestId('upload-page-error-dismiss').click();
    }
  });

  test('FMT-S3 names the same formats in the drop zone, the guidelines and the picker, in English and Arabic', async ({ page }) => {
    for (const [locale, formats] of [['en', FORMATS_EN], ['ar', FORMATS_AR]] as const) {
      await gotoUpload(page, locale);
      await expect(page.getByTestId('upload-supported-formats')).toContainText(formats);
      await expect(page.getByTestId('upload-guideline-formats')).toContainText(formats);
      const accept = (await uploadUi(page).fileInput.getAttribute('accept')) ?? '';
      for (const ext of ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi']) expect(accept.split(',')).toContain(ext);
      for (const type of ['video/quicktime', 'video/x-matroska', 'video/x-msvideo']) expect(accept.split(',')).toContain(type);
    }
  });

  test('FMT-S4 accepts a file dropped on the drop zone: an iPhone MOV and a MKV with no type', async ({ page }) => {
    const ui = uploadUi(page);
    await gotoUpload(page, 'en');
    for (const [name, mimeType] of [['IMG_0001.MOV', 'video/quicktime'], ['lesson.mkv', '']] as const) {
      const dataTransfer = await dropped(page, [{ name, mimeType }]);
      await ui.dropzone.dispatchEvent('drop', { dataTransfer });
      await expect(ui.details).toBeVisible();
      await expect(ui.fileName).toHaveText(name);
      await expect(ui.pageError).toHaveCount(0);
      await ui.close.click();
      await expect(ui.dropzone).toBeVisible();
    }
    // A text file dropped there is refused
    await ui.dropzone.dispatchEvent('drop', { dataTransfer: await dropped(page, [{ name: 'notes.txt', mimeType: 'text/plain' }]) });
    await expect(ui.pageError).toContainText(FORMATS_EN);
    await expect(ui.details).toBeHidden();
  });
});

test.describe('Video formats - batch upload', () => {
  test('FMT-B1 queues one clip of every format with the types browsers report, uploads them and stores each type', async ({ page }) => {
    const tracker = trackUploads(page);
    await openBatch(page);
    const clips = namedClips(prefix);
    // The first type a browser reports for each format; MKV with no type
    await page.getByTestId('batch-file-input').setInputFiles(clips.map((c) => asFile(c, c.reported[0]!)));
    const items = page.getByTestId('batch-file');
    await expect(items).toHaveCount(6);
    await expect(page.getByTestId('upload-page-error')).toHaveCount(0);

    await page.getByTestId('batch-start').click();
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '6', { timeout: 180_000 });

    expect(tracker.videoIds.size).toBe(6);
    const stored = await Promise.all([...tracker.videoIds].map((id) => storedFormat(id)));
    expect(stored.sort()).toEqual(clips.map((c) => c.sent).sort());
  });

  test('FMT-B2 takes the alternative types too: M4V reported as mp4, MKV and an octet-stream MOV with no useful type, both names of AVI', async ({ page }) => {
    await openBatch(page);
    const clip = (label: string) => namedClips(prefix).find((c) => c.label === label)!;
    const named = (c: FormatClip, n: number, mimeType: string) => ({ name: c.name.replace(' ' + c.label, ` alt ${n}`), mimeType, buffer: c.buffer });
    await page.getByTestId('batch-file-input').setInputFiles([
      named(clip('M4V'), 1, 'video/mp4'),
      named(clip('MKV'), 2, ''),
      named(clip('AVI'), 3, 'video/avi'),
      named(clip('AVI'), 4, 'video/vnd.avi'),
      named(clip('MOV'), 5, 'application/octet-stream'),
    ]);
    await expect(page.getByTestId('batch-file')).toHaveCount(5);
    await expect(page.getByTestId('upload-page-error')).toHaveCount(0);
  });

  test('FMT-B3 refuses the whole pick when one file is not on the list, naming it and the list', async ({ page }) => {
    await openBatch(page);
    const [mp4] = namedClips(prefix);
    const [text] = refusedFiles(prefix);
    await page.getByTestId('batch-file-input').setInputFiles([asFile(mp4!, 'video/mp4'), text!]);
    const error = page.getByTestId('upload-page-error');
    await expect(error).toContainText(text!.name);
    await expect(error).toContainText(FORMATS_EN);
    await expect(page.getByTestId('batch-file')).toHaveCount(0);
  });

  test('FMT-B4 names the formats in the batch drop zone, in Arabic too', async ({ page }) => {
    await openBatch(page, 'en');
    await expect(page.getByTestId('batch-dropzone')).toContainText(FORMATS_EN);
    await openBatch(page, 'ar');
    await expect(page.getByTestId('batch-dropzone')).toContainText(FORMATS_AR);
    const accept = (await page.getByTestId('batch-file-input').getAttribute('accept')) ?? '';
    expect(accept.split(',')).toContain('.mkv');
  });

  test('FMT-B5 queues files dropped on the batch drop zone: a MOV, a MKV with no type and an AVI', async ({ page }) => {
    await openBatch(page);
    const zone = page.getByTestId('batch-dropzone');
    const dataTransfer = await dropped(page, [
      { name: `${prefix} drop 1.MOV`, mimeType: 'video/quicktime' },
      { name: `${prefix} drop 2.mkv`, mimeType: '' },
      { name: `${prefix} drop 3.avi`, mimeType: 'video/avi' },
    ]);
    await zone.dispatchEvent('dragover', { dataTransfer });
    await zone.dispatchEvent('drop', { dataTransfer });
    await expect(page.getByTestId('batch-file')).toHaveCount(3);
    await expect(page.getByTestId('upload-page-error')).toHaveCount(0);
  });

  test('FMT-B6 refuses a text file dropped on the batch drop zone', async ({ page }) => {
    await openBatch(page);
    const zone = page.getByTestId('batch-dropzone');
    await zone.dispatchEvent('drop', { dataTransfer: await dropped(page, [{ name: `${prefix} notes.txt`, mimeType: 'text/plain' }]) });
    await expect(page.getByTestId('upload-page-error')).toContainText(FORMATS_EN);
    await expect(page.getByTestId('batch-file')).toHaveCount(0);
  });
});
