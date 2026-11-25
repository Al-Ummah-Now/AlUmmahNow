/**
 * Server-side record of creator Terms of Service & Community Guidelines acceptance
 * (Play UGC policy, AlUmmahNowAndroid#65, AlUmmahNowApple#93).
 *
 * Stored in `creator_terms_acceptances` keyed by `user_id` PK so acceptance is
 * asked once per account across web and native Studio apps, with zero D1 scans.
 */
import { CURRENT_CREATOR_TERMS_VERSION } from '@al-ummah/shared-types';

export interface CreatorTermsAcceptance {
	termsVersion: string;
	acceptedAt: string;
}

export async function readCreatorTermsAcceptance(db: D1Database | undefined, userId: string): Promise<CreatorTermsAcceptance | null> {
	if (!db) return null;
	const row = await db
		.prepare('SELECT terms_version, accepted_at FROM creator_terms_acceptances WHERE user_id = ?')
		.bind(userId)
		.first<{ terms_version: string; accepted_at: string }>();
	if (!row) return null;
	return { termsVersion: row.terms_version, acceptedAt: row.accepted_at };
}

export async function hasAcceptedCreatorTerms(
	db: D1Database | undefined,
	userId: string,
	version: string = CURRENT_CREATOR_TERMS_VERSION,
): Promise<boolean> {
	const row = await readCreatorTermsAcceptance(db, userId);
	return row?.termsVersion === version;
}

export async function recordCreatorTermsAcceptance(
	db: D1Database,
	userId: string,
	version: string = CURRENT_CREATOR_TERMS_VERSION,
	nowIso: string = new Date().toISOString(),
): Promise<CreatorTermsAcceptance> {
	await db
		.prepare(
			`INSERT INTO creator_terms_acceptances (user_id, terms_version, accepted_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   terms_version = excluded.terms_version,
			   accepted_at = excluded.accepted_at
			 WHERE creator_terms_acceptances.terms_version < excluded.terms_version`,
		)
		.bind(userId, version, nowIso)
		.run();
	const stored = await readCreatorTermsAcceptance(db, userId);
	return stored ?? { termsVersion: version, acceptedAt: nowIso };
}

export async function eraseCreatorTermsAcceptance(db: D1Database | undefined, userId: string): Promise<number> {
	if (!db) return 0;
	const res = await db.prepare('DELETE FROM creator_terms_acceptances WHERE user_id = ?').bind(userId).run();
	return Number(res.meta?.changes ?? 0);
}
