/**
 * The web suite's specs (apps/web/playwright.config.ts) that have moved to the local stack
 * (local-e2e.yml, docs/testing/LOCAL-STACK.md), sub-batch by sub-batch. With E2E_ENV=local the
 * config runs only these; against QA (e2e-tests.yml) it leaves them out. A spec is added here
 * once it is green on the local stack and seeds its own data (release/builders.ts or the run's
 * own accounts from auth.setup.ts). Paths are relative to apps/web/e2e.
 *
 * Plain data, no imports.
 */
export const LOCAL_WEB_SPECS: readonly string[] = [
  // Sub-batch 1: pages, navigation, sessions and guards
  '01-homepage.spec.ts',
  '03-profile.spec.ts',
  '04-channels.spec.ts',
  '05-accessibility.spec.ts',
  '06-navigation.spec.ts',
  '08-unified-navigation.spec.ts',
  '09-channel-switching.spec.ts',
  '10-profile-guard-debug.spec.ts',
  '11-account-switching.spec.ts',
  '11-profile-guard-redirect.spec.ts',
  '22-explore.spec.ts',
  '34-live.spec.ts',
  '35-errors-404.spec.ts',
  '50-channels-directory.spec.ts',
  '65-consent-banner.spec.ts',
  '72-real-sign-in.spec.ts',
  '75-site-theme.spec.ts',
  // Sub-batch 2: watch page, player, library, comments, history, home grid
  '02-video-player.spec.ts',
  '14-video-upload-playback.spec.ts',
  '21-library.spec.ts',
  '30-watch-page.spec.ts',
  '32-comments.spec.ts',
  '33-watch-history.spec.ts',
  '60-home-videos.spec.ts',
  '71-no-console-errors.spec.ts',
  // Sub-batch 3: search, notifications, video comments, channel page and sections, playlists, feed
  '21-search-v2.spec.ts',
  '22-notifications.spec.ts',
  '22-video-comments.spec.ts',
  '51-channel-page.spec.ts',
  '52-channel-sections.spec.ts',
  '54-playlists.spec.ts',
  '66-feed-subscriptions.spec.ts',
  // Sub-batch 4: uploads (tus proxy, resume, logs, form, batch, templates) and Studio editing
  '12-video-upload.spec.ts',
  '13-video-upload-tus-resume.spec.ts',
  '15-video-edit.spec.ts',
  '16-thumbnail-management.spec.ts',
  '17-tus-proxy-upload.spec.ts',
  '18-tus-proxy-logs.spec.ts',
  '19-studio-videos-ownership.spec.ts',
  '40-upload-form.spec.ts',
  '41-batch-upload.spec.ts',
  '42-upload-templates.spec.ts',
  '43-video-edit-schedule.spec.ts',
  '44-video-chapters-subtitles.spec.ts',
  // Sub-batch 5: the axe sweep of every page (a11y project)
  'a11y/axe-all-pages.spec.ts',
  // Sub-batch 6: account, profile, settings, channel settings, community, playlist tools, media boxes
  '21-channel-handles-owner.spec.ts',
  '21-watch-later-per-user.spec.ts',
  '53-channel-settings.spec.ts',
  '55-community.spec.ts',
  '56-playlist-tools.spec.ts',
  '61-header-drawer.spec.ts',
  '62-account-menu.spec.ts',
  '63-profile.spec.ts',
  '64-settings-privacy.spec.ts',
  '74-no-empty-media.spec.ts',
  '75-save-to-playlist-menu.spec.ts',
  // Sub-batch 7: player, watch loading, embeds and the player's axe checks on the file's own videos
  '20-accessibility-axe.spec.ts',
  '31-video-player.spec.ts',
  '70-embeds.spec.ts',
  '73-watch-loading.spec.ts',
];
