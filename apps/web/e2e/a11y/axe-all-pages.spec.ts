import { test, expect } from '../fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import { ANONYMOUS_STATE, AUTH_STATE } from '../test-utils/auth-state';
import { catalog, catalogFromOwnData, openCatalogPageInReferenceTheme, type CatalogData, type CatalogRole } from '../test-utils/page-catalog';
import { ownPublicVideos } from '../test-utils/own-public-video';
import { ownStudioVideos } from '../test-utils/own-studio-videos';
import { SEED_TITLES } from '../test-utils/e2e-videos';

/**
 * A11Y-ALL: axe-core WCAG 2.1 AA scan of every page in the route inventory
 * (docs/testing/UI-TEST-PLAN.md), in English (LTR) and Arabic (RTL), light
 * and dark colour schemes. Runs in the dedicated `a11y` project (Desktop
 * Chrome); axe results do not depend on the browser engine.
 *
 * The video element itself is excluded: bundled Chromium cannot decode the
 * H.264 stream and the player's own controls are covered in depth by
 * 20-accessibility-axe.spec.ts with a codec-capable browser.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ROLES: CatalogRole[] = ['anon', 'single', 'none'];

let data: CatalogData;

// Not one group: its ~180 page scans spread over the shards (each worker makes its own data)

/**
 * This file's own content (made in beforeAll, deleted afterwards): a creator's channel with a
 * public video (English and Arabic titles), a playlist and a community post, and the single
 * user's own Studio videos for the editor page.
 */
const own = ownPublicVideos(test, 'a11y-catalog', [{ titleAr: 'محاضرة فحص الوصول' }], {
  nameAr: 'قناة فحص الوصول',
  description: 'E2E accessibility sweep channel',
  descriptionAr: 'قناة فحص إمكانية الوصول',
  playlist: true,
  posts: 1,
});
const studio = ownStudioVideos(test, 'single');

test.beforeAll(async () => {
  data = catalogFromOwnData({
    videoId: own.videos()[0].id,
    channelId: own.channelId(),
    playlistId: own.playlistId(),
    singleVideoId: studio.videos()[SEED_TITLES.singleVideo].id,
  });
});

function storageFor(role: CatalogRole) {
  return role === 'anon' ? ANONYMOUS_STATE : AUTH_STATE[role];
}

// Catalog ids are static; the ids that need QA data resolve in beforeAll
const PLACEHOLDER: CatalogData = {
  lectureVideoId: 'x',
  lecturesChannelId: 'x',
  playlistId: 'x',
  singleChannelId: 'x',
  singleSeedVideoId: 'x',
};

for (const role of ROLES) {
  test.describe(`axe - ${role}`, () => {
    test.use({ storageState: storageFor(role) });

    for (const entry of catalog(PLACEHOLDER).filter((p) => p.role === role)) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const locale of ['en', 'ar'] as const) {
          test(`A11Y-ALL ${entry.id} (${locale}, ${colorScheme}) has no WCAG 2.1 AA violations`, async ({ page }) => {
            const resolved = catalog(data).find((p) => p.id === entry.id && p.role === role);
            expect(resolved, `catalog entry ${entry.id}`).toBeTruthy();
            // Contrast results follow the site theme: scan in the reference theme (Lantern, a stable
            // reference, not production's: production runs Fawanees), not whatever the stack's active
            // theme is; e2e/themes checks contrast in every theme, Fawanees included
            await openCatalogPageInReferenceTheme(page, locale, resolved!, colorScheme);
            await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

            const results = await new AxeBuilder({ page })
              .withTags(WCAG_TAGS)
              .exclude('video')
              .analyze();
            const summary = results.violations
              .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`)
              .join('\n');
            expect(results.violations, summary).toEqual([]);
          });
        }
      }
    }
  });
}
