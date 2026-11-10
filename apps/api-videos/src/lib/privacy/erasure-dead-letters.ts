/**
 * Account erasure failures for the admin Errors page (#616). The processor's
 * erasure steps (UserDataErased, and its Contact us step ContactDataErase)
 * retry with backoff; one that still fails is dead-lettered and stored by the
 * processor in NOTIFICATIONS_DB.dead_letters, which this reads.
 */
export const ERASURE_TYPE_NAMES = ['UserDataErased', 'ContactDataErase'] as const;

export interface ErasureDeadLetter {
	id: string;
	/** Which erasure step failed */
	step: (typeof ERASURE_TYPE_NAMES)[number];
	userId?: string;
	attempts: number;
	failureReason: string | null;
	receivedAt: string | number;
}

export interface DeadLetterRow {
	id: string;
	type_name: string;
	attempts: number;
	failure_reason: string | null;
	body_json: string;
	received_at: string | number;
}

export function toErasureDeadLetter(row: DeadLetterRow): ErasureDeadLetter {
	let userId: string | undefined;
	try {
		const body = JSON.parse(row.body_json) as { payload?: { userId?: unknown } };
		userId = typeof body.payload?.userId === 'string' ? body.payload.userId : undefined;
	} catch {
		userId = undefined;
	}
	return {
		id: row.id,
		step: row.type_name as ErasureDeadLetter['step'],
		userId,
		attempts: row.attempts,
		failureReason: row.failure_reason,
		receivedAt: row.received_at,
	};
}

/** Not yet replayed erasure dead letters, newest first. */
export async function readErasureDeadLetters(db: D1Database, limit: number): Promise<ErasureDeadLetter[]> {
	const { results } = await db
		.prepare(
			`SELECT id, type_name, attempts, failure_reason, body_json, received_at FROM dead_letters
			 WHERE replayed_at IS NULL AND type_name IN (${ERASURE_TYPE_NAMES.map(() => '?').join(', ')})
			 ORDER BY received_at DESC LIMIT ?`,
		)
		.bind(...ERASURE_TYPE_NAMES, limit)
		.all<DeadLetterRow>();
	return (results ?? []).map(toErasureDeadLetter);
}
