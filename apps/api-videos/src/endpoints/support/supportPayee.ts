/**
 * Studio › Support payee API (wiki AUN-MEMBERS §2.4; MEM-22). Signed in; the channel's owner sets up
 * payouts, its admins read the state; editors and moderators get 404 like an unknown channel.
 *
 *   GET  /api/channels/:channelId/support/payee           the payee's state (never bank details)
 *   POST /api/channels/:channelId/support/payee/onboard   { country, returnPath } → { url, expiresAt } (owner)
 *   POST /api/channels/:channelId/support/payee/refresh   re-reads the state from the rail (owner)
 *
 * Every route answers 404 feature_off while `creatorSupport` is off (everywhere today).
 */
import type { Context } from 'hono';
import { roleOnChannel, type ChannelAccessEnv } from '../../lib/channelAccess';
import { featureOff } from '../../lib/features/off';
import { createJob } from '../../lib/admin/jobs';
import { logger } from '../../lib/logger';
import { vendorContext, type SupportJobEnv } from '../../lib/support/jobs';
import { readSupportConfig } from '../../lib/support/config';
import { PayeeError, payeeView, startPayeeOnboarding } from '../../lib/support/payees';
import { supportSwitch } from '../../lib/support/switch';
import { RailError } from '../../lib/support/rail';

type Env = SupportJobEnv & { channels?: R2Bucket; VIDEOS_WEB_URL?: string };

const PAYEE_ERROR_STATUS: Record<PayeeError['code'], 400 | 409> = {
	invalid_country: 400,
	decision_open: 409,
	country_blocked: 409,
	country_waitlist: 409,
	country_external_link_only: 409,
	no_rail_for_country: 409,
};

/** The caller's role, or a response that ends the request. */
async function gate(c: Context, need: 'read' | 'owner'): Promise<Response | { env: Env; channelId: string; userId: string }> {
	const env = c.env as Env;
	if (!(await supportSwitch(env)).on) return featureOff(c, 'creatorSupport');
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, code: 'unauthorized' }, 401);
	const channelId = c.req.param('channelId') ?? '';
	const role = await roleOnChannel(env as unknown as ChannelAccessEnv, channelId, userId).catch(() => null);
	const allowed = need === 'owner' ? role === 'owner' : role === 'owner' || role === 'admin';
	if (!allowed) return c.json({ success: false, code: 'not_found' }, 404);
	if (!env.SEARCH_DB) return c.json({ success: false, code: 'unavailable' }, 503);
	return { env, channelId, userId };
}

function returnPath(path: unknown, channelId: string): string {
	const fallback = `/studio/support?channel=${encodeURIComponent(channelId)}`;
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path) || path.length > 300) return fallback;
	return path;
}

export async function handleSupportPayee(c: Context) {
	const g = await gate(c, 'read');
	if (g instanceof Response) return g;
	c.header('Cache-Control', 'private, no-store');
	return c.json({ success: true, result: await payeeView(g.env.SEARCH_DB!, g.channelId) });
}

export async function handleSupportPayeeOnboard(c: Context) {
	const g = await gate(c, 'owner');
	if (g instanceof Response) return g;
	const body = (await c.req.json().catch(() => null)) as { country?: unknown; returnPath?: unknown; locale?: unknown } | null;
	const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
	const web = String(g.env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	try {
		const now = new Date();
		const { mode } = await readSupportConfig(g.env.SEARCH_DB!);
		const r = await startPayeeOnboarding(g.env, { channelId: g.channelId, ownerUserId: g.userId, country, locale: body?.locale === 'ar' ? 'ar' : 'en', returnUrl: `${web}${returnPath(body?.returnPath, g.channelId)}`, ctx: vendorContext(g.env, mode, () => now), now });
		return c.json({ success: true, result: { url: r.url, expiresAt: r.expiresAt } });
	} catch (error) {
		if (error instanceof PayeeError) return c.json({ success: false, code: `support_${error.code}` }, PAYEE_ERROR_STATUS[error.code]);
		if (error instanceof RailError) {
			logger.warn('[Support] Payee onboarding link failed', { channelId: g.channelId, error: error.message });
			return c.json({ success: false, code: 'support_rail_unavailable' }, 503);
		}
		throw error;
	}
}

export async function handleSupportPayeeRefresh(c: Context) {
	const g = await gate(c, 'owner');
	if (g instanceof Response) return g;
	const row = await g.env.SEARCH_DB!.prepare('SELECT id FROM support_payees WHERE channel_id = ? ORDER BY updated_at DESC LIMIT 1').bind(g.channelId).first<{ id: string }>();
	if (!row) return c.json({ success: false, code: 'support_no_payee' }, 404);
	const job = await createJob(g.env, { kind: 'support.payee-sync', targetKind: 'support', targetId: row.id, params: { payeeId: row.id }, actorId: g.userId });
	return c.json({ success: true, result: { jobId: job.id } }, 202);
}
