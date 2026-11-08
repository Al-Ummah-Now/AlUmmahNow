/**
 * Deletes the production test accounts the release's signed-in check created
 * (apps/web/e2e/release-prod). Only test-release-<ms>-<hex>@delivered.resend.dev
 * addresses; anything else is refused before any request is made.
 *
 *   node --experimental-strip-types scripts/release/delete-test-user.ts <file-with-one-email-per-line> [--dry-run]
 *
 * Removes, in the production auth server's storage: the D1 users row (its
 * identities, refresh tokens and authorization codes cascade), the user's role and
 * account-session rows (no FK to users), and the auth KV entries
 * email␟<e>␟password|subject, user␟email␟default␟<e> and user␟default␟<id>.
 * Needs CLOUDFLARE_API_TOKEN (D1 + KV write) and CLOUDFLARE_ACCOUNT_ID.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Production auth server storage (AlUmmahNowAuth apps/auth/wrangler.json, env.production). */
export const AUTH_PROD = { d1: 'af76f007-e21e-43aa-88de-ebfefe46fb56', kv: 'c3f796d40db8420c920aef1ce10a7f13' };

export const TEST_ADDRESS = /^test-release-\d{13}-[0-9a-f]{6}@delivered\.resend\.dev$/;

export function assertTestAddress(email: string): void {
	if (!TEST_ADDRESS.test(email)) throw new Error(`refusing to delete ${JSON.stringify(email)}: not a release test account`);
}

const SEP = '\x1f';

/** KV key prefixes of one user (openauth joins key parts with U+001F). */
export function kvPrefixes(email: string, userId?: string): string[] {
	const prefixes = [`email${SEP}${email}${SEP}`, `user${SEP}email${SEP}default${SEP}${email}`];
	if (userId) prefixes.push(`user${SEP}default${SEP}${userId}`);
	return prefixes;
}

/** D1 statements (with params) that delete one user. */
export function deleteStatements(userId: string): { sql: string; params: string[] }[] {
	return [
		{ sql: 'DELETE FROM rbac_user_roles WHERE user_id = ?', params: [userId] },
		{ sql: 'DELETE FROM account_sessions WHERE user_id = ?', params: [userId] },
		{ sql: 'DELETE FROM users WHERE id = ?', params: [userId] },
	];
}

async function main(): Promise<void> {
	const [file, flag] = process.argv.slice(2);
	const dryRun = flag === '--dry-run';
	const emails = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
	emails.forEach(assertTestAddress);
	const token = process.env.CLOUDFLARE_API_TOKEN;
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
	const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
		const res = await fetch(`${api}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
		const body = (await res.json()) as { success: boolean; errors?: unknown; result: T };
		if (!body.success) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${JSON.stringify(body.errors)}`);
		return body.result;
	};
	const query = async (sql: string, params: string[]) =>
		(await call<{ results: Record<string, unknown>[] }[]>(`/d1/database/${AUTH_PROD.d1}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }))[0].results;

	for (const email of emails) {
		const users = (await query('SELECT id FROM users WHERE email = ?', [email])) as { id: string }[];
		if (users.length > 1) throw new Error(`${email}: ${users.length} user rows, not deleting`);
		const userId = users[0]?.id;
		// Exact key or the prefix plus a separator, so a longer key that merely starts the same is kept
		const keys = (
			await Promise.all(
				kvPrefixes(email, userId).map(async (p) =>
					(await call<{ name: string }[]>(`/storage/kv/namespaces/${AUTH_PROD.kv}/keys?prefix=${encodeURIComponent(p)}`)).filter(
						(k) => k.name === p || k.name.startsWith(p.endsWith(SEP) ? p : p + SEP),
					),
				),
			)
		).flat();
		process.stdout.write(`${email}: user ${userId ?? 'none'}, ${keys.length} KV key(s)${dryRun ? ' (dry run)' : ''}\n`);
		if (dryRun) continue;
		if (userId) for (const s of deleteStatements(userId)) await query(s.sql, s.params);
		for (const k of keys) await call(`/storage/kv/namespaces/${AUTH_PROD.kv}/values/${encodeURIComponent(k.name)}`, { method: 'DELETE' });
		const left = (await query('SELECT count(*) AS n FROM users WHERE email = ?', [email]))[0].n;
		if (left !== 0) throw new Error(`${email}: still ${left} user row(s) after delete`);
		process.stdout.write(`${email}: deleted\n`);
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	main().catch((error) => {
		process.stderr.write(`delete-test-user: ${(error as Error).message}\n`);
		process.exit(1);
	});
}
