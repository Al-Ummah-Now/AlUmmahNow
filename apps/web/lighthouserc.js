/**
 * Lighthouse CI (@lhci/cli) for the web app, run against a deployed
 * environment (QA by default) by the "Lighthouse" job in
 * .github/workflows/e2e-tests.yml.
 *
 * Pages: home, watch, channel, search. The watch and channel URLs point at
 * QA seed content and are resolved by the workflow (LHCI_WATCH_PATH,
 * LHCI_CHANNEL_PATH) from the public API, so they survive re-seeding.
 *
 * Budgets start as warnings (non-blocking); promote individual assertions to
 * "error" once the baseline is stable.
 */
const base = (process.env.LHCI_BASE_URL || 'https://videos.qa.alummahnow.net').replace(/\/$/, '');
const paths = [
  '/en',
  process.env.LHCI_WATCH_PATH || '/en/video',
  process.env.LHCI_CHANNEL_PATH || '/en/channels',
  '/en/search?q=lecture',
  '/ar',
];

module.exports = {
  ci: {
    collect: {
      url: paths.map((p) => `${base}${p}`),
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        // Skip the PWA category (not a PWA) and keep runs comparable
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.6 }],
        'categories:accessibility': ['warn', { minScore: 0.95 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 4000 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 600 }],
        'resource-summary:script:size': ['warn', { maxNumericValue: 900000 }],
        'resource-summary:total:size': ['warn', { maxNumericValue: 3500000 }],
        'resource-summary:third-party:count': ['warn', { maxNumericValue: 25 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
