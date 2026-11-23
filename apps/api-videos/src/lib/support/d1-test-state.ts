/**
 * The test adapters' state in the search D1 (`support_test_state`, migration 0076): the local stack
 * and QA. `testStateFor` gives no store in production, so the test adapters can't run there even
 * if misconfigured.
 */
import type { SearchDb } from '@al-ummah/shared-types';
import { testAdaptersAllowed, type SupportAdapterEnv } from './adapters';
import type { TestStateStore } from './test-state';

export function d1TestState(db: SearchDb, now: () => Date = () => new Date()): TestStateStore {
	return {
		async get<T>(key: string) {
			const row = await db.prepare('SELECT value FROM support_test_state WHERE key = ?').bind(key).first<{ value: string }>();
			return row ? (JSON.parse(row.value) as T) : null;
		},
		async put<T>(key: string, value: T) {
			await db
				.prepare('INSERT INTO support_test_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
				.bind(key, JSON.stringify(value), now().toISOString())
				.run();
		},
		async list<T>(prefix: string) {
			// Range scan on the primary key (no LIKE): prefix ≤ key < prefix + U+FFFF
			const rows = await db.prepare('SELECT value FROM support_test_state WHERE key >= ? AND key < ? ORDER BY key LIMIT 500').bind(prefix, `${prefix}￿`).all<{ value: string }>();
			return (rows.results ?? []).map((r) => JSON.parse(r.value) as T);
		},
	};
}

export function testStateFor(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }): TestStateStore | undefined {
	return testAdaptersAllowed(env) && env.SEARCH_DB ? d1TestState(env.SEARCH_DB) : undefined;
}
