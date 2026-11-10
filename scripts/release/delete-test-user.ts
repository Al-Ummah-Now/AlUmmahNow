/**
 * Deletes the production test accounts a prod check created, from every store
 * (auth D1 + KV, api-videos profile, watch history, channels, search rows; see
 * prod-test-data.ts). Only test addresses (test-*@delivered.resend.dev,
 * *@e2e.alummahnow.net) are accepted; anything else is refused before any request.
 *
 *   node --experimental-strip-types scripts/release/delete-test-user.ts <file-with-one-email-per-line> [--dry-run]
 *
 * Every address is attempted even when an earlier one fails; the exit code is 1
 * if any failed. Needs CLOUDFLARE_API_TOKEN (D1, KV and R2 write) or a wrangler
 * login, and CLOUDFLARE_ACCOUNT_ID (defaults to the Al Ummah Now account).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestAddress, createCf, deleteTestAccount } from './prod-test-data.ts';

export { assertTestAddress, TEST_ADDRESS, kvKeys, authDeleteStatements } from './prod-test-data.ts';

export function readAddresses(text: string): string[] {
	const emails = [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];
	emails.forEach(assertTestAddress);
	return emails;
}

async function main(): Promise<void> {
	const [file, flag] = process.argv.slice(2);
	const dryRun = flag === '--dry-run';
	const emails = readAddresses(readFileSync(file, 'utf8'));
	const cf = createCf();
	let failed = 0;
	for (const email of emails) {
		try {
			await deleteTestAccount(cf, { email }, { dryRun });
		} catch (error) {
			failed++;
			process.stdout.write(`::error::${email}: ${(error as Error).message}\n`);
		}
	}
	if (failed) throw new Error(`${failed} of ${emails.length} account(s) not deleted`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((error) => {
		process.stderr.write(`delete-test-user: ${(error as Error).message}\n`);
		process.exit(1);
	});
}
