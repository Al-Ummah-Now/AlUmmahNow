/**
 * #616: account erasure steps that dead-lettered are listed for the admin Errors page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readErasureDeadLetters, toErasureDeadLetter } from '../src/lib/privacy/erasure-dead-letters';

const row = (over: Record<string, unknown> = {}) => ({
	id: 'dl-1',
	type_name: 'ContactDataErase',
	attempts: 4,
	failure_reason: 'D1 unavailable',
	body_json: JSON.stringify({ id: 'erase-1:contact', type: 250, payload: { userId: 'user-1' } }),
	received_at: 1794300000000,
	...over,
});

describe('erasure dead letters', () => {
	it('maps a stored dead letter to the step, user and reason', () => {
		assert.deepEqual(toErasureDeadLetter(row()), {
			id: 'dl-1',
			step: 'ContactDataErase',
			userId: 'user-1',
			attempts: 4,
			failureReason: 'D1 unavailable',
			receivedAt: 1794300000000,
		});
		assert.equal(toErasureDeadLetter(row({ body_json: '{not json' })).userId, undefined);
	});

	it('reads only unreplayed erasure steps, newest first', async () => {
		let sql = '';
		let args: unknown[] = [];
		const db = {
			prepare: (s: string) => ({
				bind: (...a: unknown[]) => {
					sql = s;
					args = a;
					return { all: async () => ({ results: [row()] }) };
				},
			}),
		} as unknown as D1Database;
		const out = await readErasureDeadLetters(db, 20);
		assert.equal(out.length, 1);
		assert.match(sql, /replayed_at IS NULL AND type_name IN \(\?, \?\)/);
		assert.match(sql, /ORDER BY received_at DESC LIMIT \?/);
		assert.deepEqual(args, ['UserDataErased', 'ContactDataErase', 20]);
	});
});
