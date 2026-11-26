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
 * - Bounded by `--max-pages` (default 10, hard cap 50). When more pages remain,
 *   the opaque R2 cursor is written to a private local file (`0o600`, `--cursor-file`)
 *   and never printed to stdout (R2 cursors may encode a key containing a user ID).
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --cursor-file /tmp/legacy-restore-backfill-qa.cursor
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --apply --confirm-1902-deployed
 *
 * Needs CLOUDFLARE_API_TOKEN (or `wrangler login`) with R2 access.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import {
	ENVIRONMENTS,
	HARD_MAX_PAGES,
	backfillLegacyRestorePointers,
	createR2BackfillStore,
	formatCliReport,
	parseCliArgs,
	readCursorFile,
	removeCursorFile,
	validateCursorDirectory,
	writeCursorFile,
	type ParsedCliArgs,
} from './legacy-restore-pointers.ts';

let cli;
try {
	cli = parseCliArgs(process.argv.slice(2));
} catch (error) {
	console.error(errorMessage(error));
	console.error(
		`Usage: backfill-legacy-restore-pointers.ts --env qa|stage|production [--apply --confirm-1902-deployed] [--cursor-file <path>] [--max-pages 1..${HARD_MAX_PAGES}] [--per-page 1..1000]`,
	);
	process.exit(2);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main(cli: ParsedCliArgs): Promise<void> {
	const token = cfToken();
	if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');

	const cursorPath = cli.cursorFile ?? join(tmpdir(), `legacy-restore-backfill-${cli.env}.cursor`);
	const file = cli.cursorFile ? readCursorFile(cli.cursorFile) : undefined;
	if (file?.warning) console.warn(`Warning: ${file.warning}`);
	validateCursorDirectory(cursorPath);
	const initialCursor = cli.cursor ?? file?.cursor;

	const { backupsBucket, profilesBucket } = ENVIRONMENTS[cli.env];
	const store = createR2BackfillStore({
		env: cli.env,
		token,
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
	});

	const report = await backfillLegacyRestorePointers(store, {
		dryRun: !cli.apply,
		cursor: initialCursor,
		maxPages: cli.maxPages,
		perPage: cli.perPage,
	});

	let savedCursorFile: string | null = null;
	try {
		if (!report.complete && report.nextCursor) {
			writeCursorFile(cursorPath, report.nextCursor);
			savedCursorFile = cursorPath;
		} else if (cli.cursorFile) {
			removeCursorFile(cli.cursorFile);
		}
	} catch (error) {
		throw new Error(`Could not ${report.complete ? 'remove' : 'save'} cursor file ${cursorPath}: ${errorMessage(error)}`);
	} finally {
		const meta = { env: cli.env, backupsBucket, profilesBucket, cursorFile: savedCursorFile, resumed: Boolean(initialCursor) };
		console.log(JSON.stringify(formatCliReport(meta, report), null, 2));
	}

	if (report.dryRun) {
		console.log('\nDry run: no remote objects written or deleted. Run only after #1902 is deployed and counts are approved, with --apply --confirm-1902-deployed.');
	}
	if (savedCursorFile) {
		const quotedCursorPath = `'${savedCursorFile.replaceAll("'", "'\\''")}'`;
		console.log(
			`\nPage cap reached (${report.pagesProcessed} pages). Resume with:\n  --env ${cli.env}${cli.apply ? ' --apply --confirm-1902-deployed' : ''} --cursor-file ${quotedCursorPath}`,
		);
	}
}

await main(cli).catch((error: unknown) => {
	console.error(errorMessage(error));
	process.exitCode = 1;
});
