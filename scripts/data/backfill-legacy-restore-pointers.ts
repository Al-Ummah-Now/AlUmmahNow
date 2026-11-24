/**
 * One-time bounded backfill for pre-existing `legacy-restore/` profile copies
 * in ADMIN_BACKUPS (./legacy-restore-pointers.ts).
 *
 * IMPORTANT:
 * - Run ONLY after the pointer-index change (#1902, api-videos lib/admin/legacy-restore.ts)
 *   is deployed to the target environment (`--apply` requires `--confirm-1902-deployed`).
 * - Scoped to one environment per run (`--env qa|stage|production`).
 * - Dry run by default (reads only, writes/deletes nothing). Pass `--apply --confirm-1902-deployed`
 *   only after reviewing and approving the dry-run counts for that environment.
 * - Bounded by `--max-pages` (default 10, hard cap 50) and resumable with `--cursor`.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --max-pages 10 --cursor <cursor>
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --apply --confirm-1902-deployed
 *
 * Needs CLOUDFLARE_API_TOKEN (or `wrangler login`) with R2 access.
 */
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import {
	ENVIRONMENTS,
	HARD_MAX_PAGES,
	backfillLegacyRestorePointers,
	createR2BackfillStore,
	parseCliArgs,
} from './legacy-restore-pointers.ts';

let cli;
try {
	cli = parseCliArgs(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(
		`Usage: backfill-legacy-restore-pointers.ts --env qa|stage|production [--apply --confirm-1902-deployed] [--cursor <cursor>] [--max-pages 1..${HARD_MAX_PAGES}] [--per-page 1..1000]`,
	);
	process.exit(2);
}

const token = cfToken();
if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');

const { backupsBucket, profilesBucket } = ENVIRONMENTS[cli.env];
const store = createR2BackfillStore({
	env: cli.env,
	token,
	accountId: process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
});

const report = await backfillLegacyRestorePointers(store, {
	dryRun: !cli.apply,
	cursor: cli.cursor,
	maxPages: cli.maxPages,
	perPage: cli.perPage,
});

console.log(JSON.stringify({ env: cli.env, backupsBucket, profilesBucket, ...report }, null, 2));
if (report.dryRun) {
	console.log('\nDry run: nothing written or deleted. Run only after #1902 is deployed and counts are approved, with --apply --confirm-1902-deployed.');
}
if (!report.complete && report.nextCursor) {
	console.log(
		`\nPage cap reached (${report.pagesProcessed} pages). Resume with:\n  --env ${cli.env}${cli.apply ? ' --apply --confirm-1902-deployed' : ''} --cursor ${report.nextCursor}`,
	);
}
