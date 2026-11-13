/**
 * Makes Help's pictures and clips from the real site (docs/features/HELP-AND-TOUR.md): every
 * picture in English and Arabic, desktop and phone, light and dark, with numbered markers drawn on
 * the controls the Help text explains; every clip on desktop in both languages and modes.
 * Output: apps/web/public/help (pictures) and public/help/clips (clips and their stills), WebP/WebM.
 *
 * Runs on the local stack (E2E_ENV=local) with its own data, deleted at the end (DataScope):
 *   pnpm --filter @al-ummah/web exec playwright test -c playwright.help.config.ts
 * CI: .github/workflows/help-pictures.yml (by hand, for every release, and on PRs that change
 * Help's pictures or this script). Needs ffmpeg (PNG → WebP, clip trimming) and Google Chrome
 * (the mini-player clip plays H.264).
 *
 * Names are fixed (exactNames), never run-tagged, because they show in the pictures. They are
 * generic on purpose: no real person or channel.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';

type Lang = 'en' | 'ar';
type Mode = 'light' | 'dark';
type Device = 'desktop' | 'phone';

const OUT = join(__dirname, '../../public/help');
const CLIPS = join(OUT, 'clips');
const LANGS: Lang[] = ['en', 'ar'];
const MODES: Mode[] = ['light', 'dark'];
const DEVICES: Device[] = ['desktop', 'phone'];
const VIEWPORT: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  desktop: { width: 1280, height: 800, scale: 1, mobile: false },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
};

const NAMES = {
  user: { en: 'Amina Yusuf', ar: 'أمينة يوسف' },
  channel: { en: 'Community Corner', ar: 'ركن المجتمع' },
  second: { en: 'Weekend Sessions', ar: 'لقاءات نهاية الأسبوع' },
  video: { en: 'Planting a balcony garden', ar: 'زراعة حديقة في الشرفة' },
  comment: { en: 'Thank you, this was really clear.', ar: 'شكرًا، كان الشرح واضحًا جدًا.' },
  post: { en: 'New videos every Friday. What should we cover next?', ar: 'مرئيات جديدة كل جمعة. ما الموضوع الذي تقترحونه؟' },
};

const data = useOwnData(test as never);
let creator: Creator;
let channelId = '';
let videoId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(CLIPS, { recursive: true });
  creator = await data.createCreator(browser, 'help', { channels: 2 });
  [channelId] = creator.channelIds;
  const user = creator.user;
  const json = (body: unknown, channel?: string) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json', ...(channel ? { channelId: channel } : {}) }, body: JSON.stringify(body) });
  expect((await apiFetch(user, '/api/profile', json({ displayName: NAMES.user.en, displayNameLocalized: NAMES.user, firstName: 'Amina', lastName: 'Yusuf' }))).status).toBeLessThan(300);
  for (const [id, name] of [[creator.channelIds[0], NAMES.channel], [creator.channelIds[1], NAMES.second]] as const) {
    expect((await apiFetch(user, `/api/channels/${id}`, json({ name: name.en, nameLocalized: name }, id))).status).toBeLessThan(300);
  }
  const video = await data.createVideo(user, channelId, { clip: 'landscape40', isPublic: true, title: NAMES.video.en, waitReady: true });
  videoId = video.id;
  expect((await apiFetch(user, `/api/videos/${videoId}`, json({ titleLocalized: NAMES.video }, channelId))).status).toBeLessThan(300);
  await data.createComment(user, videoId, channelId, NAMES.comment.en);
  await data.createPost(user, channelId, { text: NAMES.post.en });
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, opts: { signedIn?: boolean; record?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const v = VIEWPORT[device];
  const context = await browser.newContext({
    storageState: opts.signedIn === false ? { cookies: [], origins: [] } : creator.state,
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.scale,
    isMobile: v.mobile,
    hasTouch: v.mobile,
    colorScheme: mode,
    // Still pictures: the lantern street and every transition stand still
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
    ...(opts.record ? { recordVideo: { dir: opts.record, size: { width: v.width, height: v.height } } } : {}),
  });
  // No consent banner over the pictures (optional tracking declined); the tour stays away by
  // itself in an automated browser
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const page = await context.newPage();
  return { context, page };
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('nav-menu-trigger')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function openMenu(page: Page, view: 'main' | 'channels' = 'main'): Promise<Locator> {
  const menu = page.getByTestId('nav-menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByTestId('nav-menu-trigger').click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  if (view === 'channels') {
    await menu.getByTestId('nav-switch-channel').click();
    await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
  }
  return menu;
}

/** Numbered markers at the inline-start top corner of each control (Arabic digits in Arabic) */
async function mark(page: Page, lang: Lang, targets: Locator[], note: (msg: string) => void): Promise<void> {
  const boxes = [];
  for (const [i, t] of targets.entries()) {
    // A control this size or language hides (labels drop to icons, overflow menus) keeps its number
    // free rather than failing the whole picture; the run lists what was skipped
    const shown = await t.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    if (!shown) note(`marker ${i + 1} not shown: ${t}`);
    boxes.push(shown ? await t.boundingBox() : null);
  }
  if (!boxes.some(Boolean)) throw new Error('no marker target was shown');
  await page.evaluate(({ boxes, rtl }) => {
    document.querySelectorAll('[data-help-marker]').forEach((n) => n.remove());
    boxes.forEach((box, i) => {
      if (!box) return;
      const m = document.createElement('span');
      m.dataset.helpMarker = '';
      m.textContent = (i + 1).toLocaleString(rtl ? 'ar-EG' : 'en');
      const x = rtl ? box.x + box.width - 12 : box.x - 12;
      Object.assign(m.style, {
        position: 'fixed', left: `${Math.max(2, x)}px`, top: `${Math.max(2, box.y - 12)}px`, zIndex: '2147483647',
        width: '24px', height: '24px', borderRadius: '50%', display: 'grid', placeItems: 'center',
        font: '700 13px/1 system-ui, sans-serif', background: 'var(--fanous-color-primary)', color: 'var(--fanous-color-on-primary)',
        boxShadow: '0 0 0 2px var(--fanous-color-surface), 0 2px 6px rgba(0,0,0,.35)', pointerEvents: 'none',
      });
      const ring = document.createElement('span');
      ring.dataset.helpMarker = '';
      Object.assign(ring.style, {
        position: 'fixed', left: `${box.x - 3}px`, top: `${box.y - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px`,
        border: '2px solid var(--fanous-color-primary)', borderRadius: '10px', zIndex: '2147483646', pointerEvents: 'none',
      });
      document.body.append(ring, m);
    });
  }, { boxes, rtl: lang === 'ar' });
}

/** A screenshot of the area around `region` (the whole viewport when empty), saved as WebP */
async function shoot(page: Page, file: string, region: Locator[] = []): Promise<void> {
  const viewport = page.viewportSize()!;
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (region.length) {
    const boxes = (await Promise.all(region.map((r) => r.boundingBox()))).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
    const pad = 24;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
    const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
    clip = { x, y, width: right - x, height: bottom - y };
  }
  const png = join(OUT, `${file}.png`);
  await page.screenshot({ path: png, clip, animations: 'disabled' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(OUT, `${file}.webp`)]);
  rmSync(png);
}

interface Scene {
  id: string;
  signedIn?: boolean;
  /** Puts the page in the state the picture shows; returns [markers, region] */
  run: (page: Page, lang: Lang, device: Device) => Promise<[Locator[], Locator[]]>;
}

const header = (page: Page) => page.locator('header.ah');

const SCENES: Scene[] = [
  {
    id: 'start-signin',
    signedIn: false,
    run: async (page, lang) => {
      await settle(page, '', lang);
      return [[page.getByTestId('nav-menu-trigger')], [header(page)]];
    },
  },
  {
    id: 'start-profile',
    run: async (page, lang) => {
      await settle(page, '/profile/edit', lang);
      const field = page.locator('#profile-displayName');
      await field.scrollIntoViewIfNeeded();
      return [[field], [field.locator('xpath=ancestor::section[1]')]];
    },
  },
  {
    id: 'watching-actions',
    run: async (page, lang) => {
      await settle(page, `/video/${videoId}`, lang);
      const like = page.getByTestId('video-like-button').first();
      const later = page.getByTestId('watch-later-button').first();
      const save = page.locator('.watch-actions button[aria-haspopup="dialog"]').first();
      await like.scrollIntoViewIfNeeded();
      return [[like, later, save], [page.locator('.watch-actions').first(), page.getByTestId('watch-channel').first()]];
    },
  },
  {
    id: 'watching-library',
    run: async (page, lang) => {
      await settle(page, '/library', lang);
      const later = page.getByTestId('library-section-watch-later').getByRole('heading').first();
      const history = page.getByTestId('library-section-history').getByRole('heading').first();
      return [[later, history], []];
    },
  },
  {
    id: 'identity-menu',
    run: async (page, lang) => {
      await settle(page, '', lang);
      const menu = await openMenu(page);
      return [[menu.getByTestId('nav-profile-link'), menu.getByTestId('nav-active-channel'), menu.getByTestId('nav-switch-channel')], [header(page), menu]];
    },
  },
  {
    id: 'identity-switch',
    run: async (page, lang) => {
      await settle(page, '', lang);
      const menu = await openMenu(page, 'channels');
      return [[menu.getByTestId('nav-channel-group-owned').locator('p').first(), menu.getByTestId('nav-channel-option-none')], [header(page), menu]];
    },
  },
  {
    id: 'identity-comment',
    run: async (page, lang) => {
      await settle(page, `/video/${videoId}`, lang);
      const line = page.getByTestId('comment-identity').first();
      await line.scrollIntoViewIfNeeded();
      const box = page.getByTestId('comment-input').first();
      return [[line, page.getByTestId('comment-identity-switch').first()], [line, box]];
    },
  },
  {
    id: 'creating-upload',
    run: async (page, lang) => {
      await settle(page, `/upload?channel=${channelId}`, lang);
      const drop = page.locator('[data-testid="batch-dropzone"], [data-testid="upload-dropzone"]').first();
      const picker = page.getByRole('combobox').first();
      return [[picker, drop], []];
    },
  },
  {
    id: 'creating-studio',
    run: async (page, lang) => {
      await settle(page, `/studio/${channelId}/content/videos`, lang);
      const row = page.getByRole('row').filter({ hasText: lang === 'ar' ? NAMES.video.ar : NAMES.video.en }).first();
      const edit = row.getByRole('link').or(row.getByRole('button')).first();
      return [[row, edit], []];
    },
  },
  {
    id: 'community-tab',
    run: async (page, lang) => {
      await settle(page, `/channels/${channelId}?tab=community`, lang);
      const post = page.locator('article').filter({ hasText: NAMES.post.en }).first();
      await post.getByRole('button', { name: /comment|تعليق/i }).first().click();
      const line = page.getByTestId('comment-identity').first();
      await line.scrollIntoViewIfNeeded();
      return [[post, line], [post]];
    },
  },
  {
    id: 'privacy-settings',
    run: async (page, lang) => {
      await settle(page, '/settings/privacy', lang);
      const exportCard = page.locator('section[aria-labelledby="privacy-export"]');
      const deleteCard = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(Delete your data|حذف بياناتك)$/ }) }).first();
      await exportCard.scrollIntoViewIfNeeded();
      return [[exportCard.getByRole('heading'), deleteCard.getByRole('heading')], []];
    },
  },
  {
    id: 'appearance-rail',
    run: async (page, lang) => {
      await settle(page, '', lang);
      const panel = page.locator('nav.nv-panel');
      if ((await panel.getAttribute('data-open')) !== 'true') await page.getByTestId('nav-drawer-toggle').click();
      const theme = panel.getByTestId('theme-toggle');
      const language = panel.getByTestId('language-toggle');
      return [[theme, language], [panel]];
    },
  },
];

/** Every scene runs whatever another one did; the last test lists all problems at once */
const problems: string[] = [];
const notes: string[] = [];

for (const scene of SCENES) {
  test(`picture ${scene.id}`, async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    for (const lang of LANGS) for (const device of DEVICES) for (const mode of MODES) {
      const name = `${scene.id}.${lang}.${device}.${mode}`;
      const { context, page } = await open(browser, lang, device, mode, { signedIn: scene.signedIn });
      try {
        const [markers, region] = await scene.run(page, lang, device);
        await mark(page, lang, markers, (msg) => notes.push(`${name}: ${msg}`));
        await shoot(page, name, region);
      } catch (error) {
        problems.push(`${name}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
        await page.screenshot({ path: test.info().outputPath(`${name}.failed.png`), fullPage: false }).catch(() => undefined);
      } finally {
        await context.close();
      }
    }
  });
}

/** Records `act` in a fresh desktop context; keeps from `act` on, trimmed to `seconds`, plus a still */
async function clip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: (page: Page) => Promise<void>, act: (page: Page) => Promise<void>, seconds = 10): Promise<void> {
  try {
    await recordClip(browser, id, lang, mode, prepare, act, seconds);
  } catch (error) {
    problems.push(`clip ${id}.${lang}.${mode}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
  }
}

async function recordClip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: (page: Page) => Promise<void>, act: (page: Page) => Promise<void>, seconds: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'help-clip-'));
  try {
    const started = Date.now();
    const { context, page } = await open(browser, lang, 'desktop', mode, { record: dir });
    // Recorded clips move: only they keep motion on
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let offset = 0;
    try {
      await prepare(page);
      await page.screenshot({ path: join(CLIPS, `${id}.${lang}.${mode}.png`) });
      offset = (Date.now() - started) / 1000;
      await act(page);
      await page.waitForTimeout(1200);
    } finally {
      await context.close();
    }
    const raw = readdirSync(dir).find((f) => f.endsWith('.webm'))!;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', offset.toFixed(2), '-t', String(seconds), '-i', join(dir, raw), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', join(CLIPS, `${id}.${lang}.${mode}.webm`)]);
    const png = join(CLIPS, `${id}.${lang}.${mode}.png`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '80', join(CLIPS, `${id}.${lang}.${mode}.webp`)]);
    rmSync(png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('clip identity-switch', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'identity-switch', lang, mode, async (page) => {
      await settle(page, `/video/${videoId}`, lang);
      await page.getByTestId('comment-identity').first().scrollIntoViewIfNeeded();
    }, async (page) => {
      const menu = await openMenu(page, 'channels');
      await page.waitForTimeout(600);
      await menu.getByTestId('nav-channel-option-none').click();
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'member', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      // Back to the channel, so every other picture shows it active
      const again = await openMenu(page, 'channels');
      await again.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`).click();
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'channel', { timeout: 30_000 });
    }, 12);
  }
});

test('clip creating-upload', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const uploaded: string[] = [];
  data.onCleanup('help clip uploads', async () => {
    for (const id of uploaded) await apiFetch(creator.user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
  });
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'creating-upload', lang, mode, async (page) => {
      await settle(page, `/upload?channel=${channelId}`, lang);
    }, async (page) => {
      page.on('response', async (res) => {
        if (/\/api\/videos\/upload\/initiate$/.test(res.url()) && res.ok()) {
          const body = (await res.json().catch(() => ({}))) as { videoId?: string; result?: { videoId?: string } };
          const id = body.videoId ?? body.result?.videoId;
          if (id) uploaded.push(id);
        }
      });
      // A fresh copy each time: the same file twice is "Already uploaded"
      const clipPath = join(__dirname, '../test-fixtures/e2e-sample-40s.mp4');
      const copy = join(tmpdir(), `help-upload-${lang}-${mode}-${Date.now()}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clipPath, '-c', 'copy', '-metadata', `comment=${copy}`, copy]);
      await page.locator('[data-testid="batch-file-input"], input[type="file"]').first().setInputFiles(copy);
      await page.waitForTimeout(5000);
      rmSync(copy, { force: true });
    }, 9);
  }
});

test('clip watching-mini-player', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'watching-mini-player', lang, mode, async (page) => {
      await settle(page, `/video/${videoId}`, lang);
      const video = page.locator('video').first();
      await expect(video).toBeVisible({ timeout: 30_000 });
      await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play(); }).catch(() => undefined);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
    }, async (page) => {
      await page.waitForTimeout(1500);
      await page.locator('header.ah a.ah-brand').click();
      await page.waitForURL(new RegExp(`/${lang}/?$`));
      await expect(page.getByTestId('player-mini-return').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(3500);
    }, 9);
  }
});

test('every picture and clip was made', () => {
  if (notes.length) console.log(`Skipped markers:\n${notes.join('\n')}`);
  expect(problems, problems.join('\n')).toEqual([]);
});
