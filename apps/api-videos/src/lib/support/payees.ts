/**
 * Payee onboarding (wiki AUN-MEMBERS §2.4, §6.3, §7.5; MEM-22, Linear AUN-635).
 *
 * Only the channel's owner sets up payouts (the money is theirs). They are sent to the payout
 * rail's HOSTED onboarding: identity, bank account or wallet and the tax form (W-9 / W-8BEN) go
 * straight to the rail. We never see bank details, ID documents or the form itself; we keep only
 * the rail's payee reference, its status, the payout method's kind, and which tax form is on file.
 *
 * Which rail is MEM-D17 (`railForPayee`); a country no rail covers, or a country whose creators
 * are blocked / waitlisted / external-link-only on the Countries page, can't start onboarding.
 */
import type { PayeeStatus, SanctionsStatus, SearchDb, TaxForm } from '@al-ummah/shared-types';
import { railForPayee, type SupportAdapterEnv } from './adapters';
import { readSupportConfig } from './config';
import type { RailContext } from './rail';

export class PayeeError extends Error {
	constructor(
		readonly code: 'decision_open' | 'country_blocked' | 'country_waitlist' | 'country_external_link_only' | 'no_rail_for_country' | 'invalid_country',
		message: string,
	) {
		super(message);
		this.name = 'PayeeError';
	}
}

/** What Studio › Support shows about the owner's payee; never anything the rail holds for us. */
export interface PayeeView {
	status: PayeeStatus;
	rail: string | null;
	country: string | null;
	payoutCurrency: string | null;
	method: string | null;
	taxForm: TaxForm;
	sanctions: SanctionsStatus;
	/** Requirement codes the rail still needs; Studio words them in en/ar */
	requirements: string[];
	payoutsHeld: boolean;
}

const NOT_STARTED: PayeeView = { status: 'not_started', rail: null, country: null, payoutCurrency: null, method: null, taxForm: 'none', sanctions: 'pending', requirements: [], payoutsHeld: false };

interface PayeeRow {
	id: string;
	rail: string;
	mode: 'test' | 'live';
	rail_payee_ref: string | null;
	country: string | null;
	payout_currency: string | null;
	method: string | null;
	status: PayeeStatus;
	tax_form: TaxForm;
	sanctions_status: SanctionsStatus;
	requirements: string;
	payouts_held: number;
}

async function payeeRow(db: SearchDb, channelId: string, mode: string): Promise<PayeeRow | null> {
	return db.prepare('SELECT id, rail, mode, rail_payee_ref, country, payout_currency, method, status, tax_form, sanctions_status, requirements, payouts_held FROM support_payees WHERE channel_id = ? AND mode = ? ORDER BY updated_at DESC LIMIT 1').bind(channelId, mode).first<PayeeRow>();
}

export async function payeeView(db: SearchDb, channelId: string): Promise<PayeeView> {
	const config = await readSupportConfig(db);
	const row = await payeeRow(db, channelId, config.mode);
	if (!row) return NOT_STARTED;
	let requirements: string[] = [];
	try {
		requirements = JSON.parse(row.requirements || '[]');
	} catch {
		requirements = [];
	}
	return { status: row.status, rail: row.rail, country: row.country, payoutCurrency: row.payout_currency, method: row.method, taxForm: row.tax_form, sanctions: row.sanctions_status, requirements, payoutsHeld: row.payouts_held === 1 };
}

/** The Countries page's rule for creators in `country` (no row = allowed). */
export async function creatorCountryRule(db: SearchDb, country: string): Promise<'allowed' | 'blocked' | 'waitlist' | 'external_link_only'> {
	const r = await db.prepare('SELECT creators FROM support_country_rules WHERE country = ?').bind(country).first<{ creators: 'allowed' | 'blocked' | 'waitlist' | 'external_link_only' }>();
	return r?.creators ?? 'allowed';
}

/**
 * Starts (or resumes) hosted onboarding for the owner of `channelId`. Returns the rail's link,
 * valid for a short time. Idempotent per channel, rail and mode: one payee row, one rail payee.
 */
export async function startPayeeOnboarding(
	env: SupportAdapterEnv & { SEARCH_DB?: SearchDb },
	input: { channelId: string; ownerUserId: string; country: string; locale: 'en' | 'ar'; returnUrl: string; ctx: RailContext; now: Date },
): Promise<{ url: string; expiresAt: string; payeeId: string }> {
	const db = env.SEARCH_DB!;
	if (!/^[A-Z]{2}$/.test(input.country)) throw new PayeeError('invalid_country', 'Country must be an ISO 3166-1 alpha-2 code');
	const config = await readSupportConfig(db);
	if (config.policy.primaryRail === null || config.policy.fallbackRail === null) throw new PayeeError('decision_open', 'MEM-D17 is open: no payout service is chosen yet');
	const rule = await creatorCountryRule(db, input.country);
	if (rule !== 'allowed') throw new PayeeError(rule === 'blocked' ? 'country_blocked' : rule === 'waitlist' ? 'country_waitlist' : 'country_external_link_only', `Creators in ${input.country} can't set up payouts (${rule})`);
	const rail = railForPayee(env, config.policy, input.country);
	if (!rail) throw new PayeeError('no_rail_for_country', `No payout service here reaches ${input.country}`);
	const at = input.now.toISOString();
	const payeeId = `spe_${input.channelId}_${rail.id}_${config.mode}`.slice(0, 120);
	await db
		.prepare(
			`INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, country, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?)
			 ON CONFLICT (channel_id, rail, mode) DO UPDATE SET owner_user_id = excluded.owner_user_id, country = COALESCE(support_payees.country, excluded.country), updated_at = excluded.updated_at`,
		)
		.bind(payeeId, input.channelId, input.ownerUserId, rail.id, config.mode, input.country, at, at)
		.run();
	const row = await db.prepare('SELECT id FROM support_payees WHERE channel_id = ? AND rail = ? AND mode = ?').bind(input.channelId, rail.id, config.mode).first<{ id: string }>();
	const id = row?.id ?? payeeId;
	const link = await rail.createPayeeLink(input.ctx, { channelId: input.channelId, ownerUserId: input.ownerUserId, payeeId: id, country: input.country, locale: input.locale }, input.returnUrl);
	await db
		.prepare("UPDATE support_payees SET rail_payee_ref = COALESCE(rail_payee_ref, ?), status = CASE WHEN status = 'not_started' THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?")
		.bind(link.railPayeeRef, at, id)
		.run();
	return { url: link.url, expiresAt: link.expiresAt, payeeId: id };
}
