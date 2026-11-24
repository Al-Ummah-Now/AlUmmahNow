/**
 * The CI test-selection graph (wiki: "CI test selection"). Plain data, no imports.
 *
 * - NODES: a changed file takes the FIRST node whose globs match it, so specific sub-nodes come
 *   before their whole unit. A file no node matches selects every suite (fail open), and the
 *   coverage test fails until it is mapped.
 * - Workspace edges come from package.json (`workspace:*` deps), read at run time: a dep on package P
 *   is an edge from P's whole-unit node to the consumer's whole-unit node.
 * - EXTRA_EDGES are the references package.json does not declare (relative imports across units,
 *   CSS @import, config paths). `import-edges.ts` finds them and the drift test keeps this list equal
 *   to what the tree has. An edge `from → to` means "to uses from": a change in `from` reaches `to`.
 * - A node with `global: true` selects every suite when it is reached.
 * - SUITES: a suite is selected when the walk from the changed nodes reaches any node in `dependsOn`.
 */

export interface NodeDef {
  id: string;
  globs: string[];
  /** Reaching this node selects every suite. */
  global?: true;
  /** A sub-node whose changes also reach this node (and from there its users). */
  partOf?: string;
  /** The workspace unit folder whose package.json gives this node its declared edges. */
  unit?: string;
}

export interface EdgeDef {
  from: string;
  to: string;
  why: string;
}

export interface SuiteDef {
  name: string;
  workflow: string;
  /** Job ids in `workflow` that make up the suite. */
  jobs: string[];
  /** Check-run name prefix of its jobs, for the shadow report. */
  checkPrefix: string;
  dependsOn: string[];
}

/** Never selects anything: prose and repo metadata. Local E2E's own paths-ignore covers md and docs too. */
export const IGNORE: string[] = [
  '**/*.md',
  'docs/**',
  '.claude/**',
  '.serena/**',
  '.cloudflare/**',
  '.github/ISSUE_TEMPLATE/**',
  '.github/stories/**',
  '.github/pull_request_template.md',
  '.github/dependabot.yml',
  'FEATURE_REQUESTS/**',
  '.gitignore',
  '**/.gitignore',
  '.mcp.json',
  '**/*.png.old',
  'apps/web/*.old',
];

/** The eight Workers the local stack boots from this repo (scripts/local-stack/stack.ts). */
const STACK_APPS = '{web,admin-web,api-videos,admin-api,processor,websocket-server,status,short-links}';

export const PLACEMENT_FILE = 'apps/web/e2e/test-utils/placement.ts';

export const NODES: NodeDef[] = [
  // ---- Global inputs: any change runs everything ----
  {
    id: 'global:dependencies',
    global: true,
    // A workspace package.json: its deps change with the lockfile, and the stack scripts read apps/web's
    globs: ['pnpm-lock.yaml', 'package.json', 'package-lock.json', 'pnpm-workspace.yaml', '.npmrc', 'patches/**', 'apps/*/package.json', 'packages/*/package.json'],
  },
  { id: 'global:build-config', global: true, globs: ['turbo.json', 'tsconfig.json', 'tsconfig.base.json'] },
  {
    id: 'global:ci',
    global: true,
    globs: [
      '.github/workflows/local-e2e.yml',
      '.github/workflows/player-e2e.yml',
      '.github/workflows/deploy.yml',
      '.github/actions/**',
      // The selector itself, and the scripts the suites' jobs and configs run
      'scripts/ci/select/**',
      'scripts/ci/{playwright-outcomes,qa-lock}.ts',
    ],
  },
  {
    id: 'global:local-stack',
    global: true,
    globs: ['scripts/local-stack/**', 'scripts/e2e/**', `apps/${STACK_APPS}/wrangler*.{json,jsonc,toml}`],
  },
  // The placement table itself is diffed row by row (select.ts); the rest of the shared harness is global
  { id: 'e2e:placement', globs: [PLACEMENT_FILE] },
  // ---- E2E specs and suite configs: each belongs to one suite ----
  {
    id: 'e2e:web-specs',
    globs: [
      'apps/web/e2e/*.spec.ts',
      'apps/web/e2e/a11y/**',
      'apps/web/e2e/visual/**',
      'apps/web/playwright.config.ts',
    ],
  },
  { id: 'e2e:release-specs', globs: ['apps/web/e2e/release/**/*.spec.ts', 'apps/web/playwright.release.config.ts'] },
  { id: 'e2e:player-specs', globs: ['apps/web/e2e/player/**', 'apps/web/playwright.player.config.ts'] },
  { id: 'e2e:admin-specs', globs: ['apps/admin-web/e2e/**', 'apps/admin-web/playwright.config.ts'] },
  {
    id: 'global:e2e-harness',
    global: true,
    globs: [
      'apps/web/e2e/test-utils/**',
      'apps/web/e2e/seed/**',
      'apps/web/e2e/test-fixtures/**',
      // Release-suite builders and helpers are shared by the web and admin suites
      'apps/web/e2e/release/**/*.ts',
      'apps/web/e2e/*.ts',
    ],
  },

  // Suites outside Local E2E and Player E2E (theme visibility, help pictures, production checks)
  {
    id: 'e2e:other-web-suites',
    globs: [
      'apps/web/e2e/themes/**',
      'apps/web/e2e/help-capture/**',
      'apps/web/e2e/release-prod/**',
      'apps/web/playwright.{themes,help,release-prod}.config.ts',
    ],
  },
  // Lint checks and other workflows' helpers (locale-format baseline, quarantine check, nightly
  // issue, artifact secret scan) and their tests: `pnpm test:scripts` runs them on every PR
  { id: 'ci:tooling', globs: ['scripts/ci/**'] },
  // Other workflows: their own triggers decide when they run; none of the selected suites runs them
  { id: 'ci:other-workflows', globs: ['.github/**'] },

  // ---- Unit tests: they run in deploy.yml's `test` job on every PR, never in an E2E suite ----
  {
    id: 'unit-tests',
    globs: [
      'apps/*/test/**',
      'packages/*/test/**',
      'apps/**/__tests__/**',
      'packages/**/__tests__/**',
      'apps/**/__mocks__/**',
      'apps/**/*.{test,spec}.{ts,tsx,js,mjs}',
      'packages/**/*.{test,spec}.{ts,tsx,js,mjs}',
      'apps/*/{jest,vitest}.config.{js,ts,mjs,cjs}',
      'apps/*/jest.setup.{js,ts}',
      'packages/*/{jest,vitest}.config.{js,ts,mjs,cjs}',
    ],
  },

  // ---- Sub-nodes inside units ----
  // fanous-tokens tooling: the generators (their output in generated/ is the runtime part and is
  // checked by `pnpm check:tokens`), the colour lint and the package's own tests. No app loads them.
  {
    id: 'fanous-tokens:tooling',
    globs: [
      'packages/fanous-tokens/src/{cli,color-lint,color-lint-cli,generate,player}.ts',
      'packages/fanous-tokens/src/generators/**',
      'packages/fanous-tokens/test/**',
      'theme-colors.allowlist.json',
    ],
  },
  // The player paths Player E2E has always run for (player-e2e.yml's paths: filter)
  {
    id: 'web:player',
    partOf: 'web',
    globs: [
      'apps/web/src/components/VideoPlayer/**',
      'apps/web/src/components/VideoPagePlayer/**',
      'apps/web/src/lib/video/**',
      'apps/web/src/lib/accessibility/**',
      'apps/web/src/styles/player-skin.css',
      'apps/web/src/styles/video-player.css',
      'apps/web/src/app/*/dev/player/**',
      // Resume: saved progress on the device and from the API (#1696)
      'apps/web/src/hooks/useWatchProgress.ts',
      'apps/web/src/services/api/watch-history.ts',
      'apps/web/src/lib/storage/**',
      'apps/web/src/lib/crypto.ts',
      // next ships its own React: a framework change can break the player (#1696)
      'apps/web/next.config.ts',
    ],
  },
  // cost-monitor's D1 migrations are applied through admin-api's config (COSTS_DB), which the stack boots
  { id: 'cost-monitor:migrations', globs: ['apps/cost-monitor/migrations/**', 'apps/cost-monitor/migrations*.schema.snapshot.sql'] },
  // shared-types files the local stack's own scripts import
  { id: 'shared-types:stack', partOf: 'shared-types', globs: ['packages/shared-types/src/queue.ts'] },
  // scripts/release helpers the local stack and other script folders import
  { id: 'scripts:release-shared', globs: ['scripts/release/{jsonc,cf-api,upload-budget}.ts'] },

  // ---- Whole units ----
  { id: 'web', unit: 'apps/web', globs: ['apps/web/**'] },
  { id: 'admin-web', unit: 'apps/admin-web', globs: ['apps/admin-web/**'] },
  { id: 'api-videos', unit: 'apps/api-videos', globs: ['apps/api-videos/**'] },
  { id: 'admin-api', unit: 'apps/admin-api', globs: ['apps/admin-api/**'] },
  { id: 'processor', unit: 'apps/processor', globs: ['apps/processor/**'] },
  { id: 'websocket-server', unit: 'apps/websocket-server', globs: ['apps/websocket-server/**'] },
  { id: 'status', unit: 'apps/status', globs: ['apps/status/**'] },
  { id: 'short-links', unit: 'apps/short-links', globs: ['apps/short-links/**'] },
  // Not on the local stack: unit tests and type-check only
  { id: 'scheduler', unit: 'apps/scheduler', globs: ['apps/scheduler/**'] },
  { id: 'media', unit: 'apps/media', globs: ['apps/media/**'] },
  { id: 'cost-monitor', unit: 'apps/cost-monitor', globs: ['apps/cost-monitor/**'] },
  { id: 'log-service', unit: 'apps/log-service', globs: ['apps/log-service/**'] },
  { id: 'shared-types', unit: 'packages/shared-types', globs: ['packages/shared-types/**'] },
  { id: 'logger', unit: 'packages/logger', globs: ['packages/logger/**'] },
  { id: 'theme-packages', unit: 'packages/theme-packages', globs: ['packages/theme-packages/**'] },
  { id: 'fanous-tokens', unit: 'packages/fanous-tokens', globs: ['packages/fanous-tokens/**'] },
  { id: 'app-icons', unit: 'packages/app-icons', globs: ['packages/app-icons/**'] },
  { id: 'mcp-log-server', unit: 'packages/mcp-log-server', globs: ['packages/mcp-log-server/**'] },
  // Operational scripts: run by hand or by their own workflows, tested by `pnpm test:scripts`
  {
    id: 'scripts:ops',
    globs: [
      'scripts/release/**',
      'scripts/qa/**',
      'scripts/migrations/**',
      'scripts/data/**',
      'scripts/media-cdn/**',
      'scripts/ops/**',
      // The release manifest tool the app repos copy (AUN-APP-UPDATES APPUPD-4)
      'scripts/app-release/**',
      'scripts/check-committed-secrets.mjs',
    ],
  },
  // Root files no build or suite reads (hand-run helpers, sample data)
  {
    id: 'repo:misc',
    globs: [
      '{cleanup-pr-previews,cleanup-pr-workers-api,delete-pr-workers,dev-with-logs,restart-dev}.sh',
      'monitor-logs.ts',
      'test-channel-123.json',
    ],
  },
];

/** Units whose files are split into sub-nodes by role: references between their sub-nodes are checked too. */
export const SPLIT_UNITS: string[] = ['packages/fanous-tokens'];

export const EXTRA_EDGES: EdgeDef[] = [
  // fanous-tokens runtime files (nav, street, generated CSS/JS, tokens) that apps load by relative path
  { from: 'fanous-tokens', to: 'web', why: 'apps/web/src/app/globals.css → fanous-tokens/nav/aun-nav.css; tailwind brand.cjs; header and menu-fit JS' },
  { from: 'fanous-tokens', to: 'admin-web', why: 'admin-web globals.css, HeaderParts, site-theme page → fanous-tokens nav, street, generated' },
  { from: 'fanous-tokens', to: 'status', why: 'apps/status/src/render.ts → fanous-tokens/nav/header.js' },
  { from: 'fanous-tokens', to: 'theme-packages', why: 'theme-packages/scripts/base-data.ts → fanous-tokens/src/themes.ts and tokens/' },
  { from: 'fanous-tokens', to: 'e2e:player-specs', why: 'apps/web/e2e/player/harness.ts → fanous-tokens/generated-player' },
  // web's theme CSS, built into admin-web
  { from: 'web', to: 'admin-web', why: 'admin-web globals.css → apps/web/src/theme/site-themes.css and materials.css' },
  // cost-monitor's migrations are applied to admin-api's COSTS_DB
  { from: 'cost-monitor:migrations', to: 'global:local-stack', why: 'apps/admin-api/wrangler.jsonc (booted by the stack) migrations_dir → apps/cost-monitor/migrations' },
  // The player code imports @al-ummah/shared-types; package.json declares it for apps/web as a whole
  { from: 'shared-types', to: 'web:player', why: 'apps/web/src/components/VideoPlayer and lib/video import @al-ummah/shared-types' },
  // Files the local stack scripts load
  { from: 'shared-types:stack', to: 'global:local-stack', why: 'scripts/local-stack/run-teardown.ts → packages/shared-types/src/queue.ts' },
  { from: 'scripts:release-shared', to: 'global:local-stack', why: 'scripts/local-stack/boot.ts → scripts/release/jsonc.ts' },
];

export const SUITES: Record<string, SuiteDef> = {
  web: {
    name: 'Local web suite',
    workflow: 'local-e2e.yml',
    jobs: ['web'],
    checkPrefix: 'Local web suite',
    // Specs placed local in apps/web/e2e, run against these stack apps (placement.ts reasons)
    dependsOn: ['e2e:web-specs', 'web', 'api-videos', 'processor', 'websocket-server', 'short-links'],
  },
  admin: {
    name: 'Local admin suite',
    workflow: 'local-e2e.yml',
    jobs: ['admin'],
    checkPrefix: 'Local admin suite',
    // web: 11-site-theme and 15-invites land on web; status: 20-status-page, 23-status-subscriptions
    dependsOn: ['e2e:admin-specs', 'admin-web', 'admin-api', 'api-videos', 'processor', 'websocket-server', 'status', 'web'],
  },
  release: {
    name: 'Local release suite',
    workflow: 'local-e2e.yml',
    jobs: ['release'],
    checkPrefix: 'Local release suite',
    dependsOn: ['e2e:release-specs', 'web', 'admin-web', 'api-videos', 'admin-api', 'processor', 'websocket-server', 'status', 'short-links'],
  },
  player: {
    name: 'Player E2E',
    workflow: 'player-e2e.yml',
    jobs: ['player-e2e'],
    checkPrefix: 'Player E2E',
    // Runs on a local `next dev` with the player harness page: the player paths and the theme files it loads
    dependsOn: ['e2e:player-specs', 'web:player', 'fanous-tokens'],
  },
};

/** Local E2E's build job runs when any suite that boots the stack is selected. */
export const BUILD_JOB = { job: 'build', checkPrefix: 'Build local stack', for: ['web', 'admin', 'release'] };

/** Labels that turn selection off for a pull request. */
export const FULL_LABELS = ['ci:full'];
