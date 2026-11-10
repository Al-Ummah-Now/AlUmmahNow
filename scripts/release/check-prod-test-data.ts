/**
 * Guard: fails when production holds any test-account data (prod-test-data.ts
 * says what counts): auth users and KV entries of test addresses, their videos
 * profiles, channels, watch history and search/ownership rows.
 *
 *   node --experimental-strip-types scripts/release/check-prod-test-data.ts [--delete] [--min-age-minutes <n>]
 *
 * Runs after every production test run (release.yml, prod-signed-in.yml) and
 * daily (prod-test-data.yml), so a leftover from any source, including a probe
 * run by hand, fails CI instead of showing on the site. With --delete it first
 * deletes every test account it finds (deleteTestAccount), then checks again;
 * the exit code is still 1 if anything had to be deleted, so the leak is seen.
 * Accounts younger than --min-age-minutes (default 60) are left alone: a prod check
 * running at the same time may still be using them; the daily run catches them later.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCf, DEFAULT_MIN_AGE_MS, deleteTestAccount, findTestAccounts, isSettled, scanLeftovers, type Leftover } from './prod-test-data.ts';

export function summarize(leftovers: Leftover[]): string {
	const byStore = new Map<string, number>();
	for (const l of leftovers) byStore.set(l.store, (byStore.get(l.store) ?? 0) + 1);
	return [...byStore].map(([s, n]) => `${s}: ${n}`).join(', ');
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const fix = args.includes('--delete');
	const i = args.indexOf('--min-age-minutes');
	const minAgeMs = i >= 0 ? Number(args[i + 1]) * 60_000 : DEFAULT_MIN_AGE_MS;
	if (!Number.isFinite(minAgeMs) || minAgeMs < 0) throw new Error('--min-age-minutes needs a number of minutes');
	const cf = createCf();
	const found = await scanLeftovers(cf, { minAgeMs });
	if (!found.length) {
		process.stdout.write('production has no test-account data\n');
		return;
	}
	process.stdout.write(`::error::production holds test-account data (${summarize(found)})\n`);
	for (const l of found) process.stdout.write(`  ${l.store} ${l.key}${l.email ? ` ${l.email}` : ''}\n`);
	if (fix) {
		const now = Date.now();
		for (const a of (await findTestAccounts(cf)).filter((a) => isSettled(a, now, minAgeMs))) {
			try {
				await deleteTestAccount(cf, a);
			} catch (error) {
				process.stdout.write(`::error::${a.email ?? a.userId}: ${(error as Error).message}\n`);
			}
		}
		const left = await scanLeftovers(cf, { minAgeMs });
		process.stdout.write(left.length ? `::error::still left after --delete: ${summarize(left)}\n` : 'deleted; production is clean now\n');
	}
	process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((error) => {
		process.stderr.write(`check-prod-test-data: ${(error as Error).message}\n`);
		process.exit(1);
	});
}
