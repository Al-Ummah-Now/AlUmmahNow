/**
 * Billing on the public API (lib/billing/service.ts, wiki AUN-SUBS):
 *
 *   GET  /api/billing/plans                      what /upgrade sells (public; empty while payments are off)
 *   GET  /api/me/billing                         the user's subscriptions and billing history
 *   POST /api/me/billing/checkout                start a checkout → { url }
 *   POST /api/me/billing/subscriptions/:id/cancel cancel (at period end where the provider can)
 *   POST /api/me/billing/portal                  the provider's customer portal URL (providers that host one)
 *
 *   POST /webhooks/billing/:provider             provider webhooks (signature checked, queued)
 *   GET  /webhooks/billing/fake/checkout/:id     the test provider's checkout page (never production)
 *   POST /webhooks/billing/fake/checkout/:id/pay "Pay (test)"
 */
import type { Context } from 'hono';
import { BILLING_ERRORS, resolveDisplayName, type NameFields } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { BillingError } from '../../lib/billing/config';
import { abandonCheckout, billingPlans, paymentReceipt, cancelOwnSubscription, myCheckout, completeFakeCheckout, fakeAvailable, myBilling, portalUrl, receiveWebhook, safeReturnPath, startCheckout, type ServiceEnv } from '../../lib/billing/service';
import { readCheckout } from '../../lib/billing/store';
import R2Repository from '../../lib/r2Repo';

type AuthCtx = { email?: string; payload?: { name?: string; email?: string } } | undefined;

function failure(c: Context, error: unknown, what: string) {
	if (error instanceof BillingError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
	logger.error(`[Billing] ${what} failed`, { userId: c.get('userId') ?? null, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'billing_unavailable', error: 'This is briefly unavailable; try again shortly', retryAfter: 30 }, 503, { 'Retry-After': '30' });
}

const env = (c: Context) => c.env as ServiceEnv;

export async function handleBillingPlans(c: Context) {
	try {
		return c.json({ success: true, result: await billingPlans(env(c)) }, 200, { 'Cache-Control': 'public, max-age=60' });
	} catch (error) {
		return failure(c, error, 'Plans');
	}
}

export async function handleMyBilling(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		return c.json({ success: true, result: await myBilling(env(c), userId) }, 200, { 'Cache-Control': 'private, no-store' });
	} catch (error) {
		return failure(c, error, 'Billing history');
	}
}

/**
 * The name and email the provider's checkout form starts with (the user can change them there):
 * the videos profile by the display-name rule (display name → first + last), its email, then the
 * sign-in's; never asks the user again for what the profile already has.
 */
export async function checkoutContact(c: Context, userId: string): Promise<{ email: string | null; name: string | null }> {
	const auth = c.get('auth') as AuthCtx;
	let profile: (NameFields & { email?: string | null }) | null = null;
	try {
		const bucket = (c.env as { profiles?: R2Bucket }).profiles;
		profile = bucket ? await new R2Repository<NameFields & { email?: string | null }>(bucket).getObject(userId) : null;
	} catch (error) {
		logger.warn('[Billing] Profile not read for the checkout name; the sign-in name is used', { userId, error: error instanceof Error ? error.message : String(error) });
	}
	const email = profile?.email || auth?.email || auth?.payload?.email || null;
	const name = resolveDisplayName(profile) || auth?.payload?.name || null;
	return { email, name };
}

export async function handleCheckout(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object') return c.json({ success: false, code: BILLING_ERRORS.invalid, error: 'A JSON body is required' }, 400);
	try {
		const result = await startCheckout(env(c), { userId, ...(await checkoutContact(c, userId)) }, body);
		return c.json({ success: true, result }, 201);
	} catch (error) {
		return failure(c, error, 'Checkout');
	}
}

export async function handleMyCheckout(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		return c.json({ success: true, result: await myCheckout(env(c), userId, c.req.param('id') ?? '') }, 200, { 'Cache-Control': 'private, no-store' });
	} catch (error) {
		return failure(c, error, 'Checkout status');
	}
}

export async function handlePaymentReceipt(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		return c.json({ success: true, result: { url: await paymentReceipt(env(c), userId, c.req.param('id') ?? '') } }, 200, { 'Cache-Control': 'private, no-store' });
	} catch (error) {
		return failure(c, error, 'Receipt');
	}
}

export async function handleAbandonCheckout(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		await abandonCheckout(env(c), userId, c.req.param('id') ?? '');
		return c.json({ success: true, result: await myCheckout(env(c), userId, c.req.param('id') ?? '') });
	} catch (error) {
		return failure(c, error, 'Checkout abandon');
	}
}

export async function handleCancelOwn(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		const job = await cancelOwnSubscription(env(c), userId, c.req.param('id') ?? '');
		return c.json({ success: true, result: { jobId: job.id, status: job.status } }, 202);
	} catch (error) {
		return failure(c, error, 'Cancel');
	}
}

export async function handlePortal(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		return c.json({ success: true, result: { url: await portalUrl(env(c), userId) } });
	} catch (error) {
		return failure(c, error, 'Portal');
	}
}

/** Provider webhooks: the raw body is read before anything parses it (the signature covers its exact bytes). */
export async function handleWebhook(c: Context) {
	const raw = await c.req.text();
	if (raw.length > 256 * 1024) return c.json({ success: false, error: 'Too large' }, 413);
	try {
		const outcome = await receiveWebhook(env(c), c.req.param('provider') ?? '', raw, c.req.raw.headers);
		if (outcome.status === 200) return c.json({ received: true, duplicate: outcome.duplicate });
		return c.json({ received: false, error: outcome.error }, outcome.status);
	} catch (error) {
		// D1 or the queue failed before the event was stored: 503 so the provider redelivers
		logger.error('[Billing] Webhook intake failed', { provider: c.req.param('provider'), error: error instanceof Error ? error.message : String(error) });
		return c.json({ received: false, error: 'Try again' }, 503);
	}
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The test provider's checkout page: plain, bilingual, test-only. */
export async function handleFakeCheckoutPage(c: Context) {
	if (!fakeAvailable(env(c))) return c.notFound();
	const id = c.req.param('id') ?? '';
	const checkout = /^bco_[0-9a-f]{32}$/.test(id) ? await readCheckout(env(c), id) : null;
	if (!checkout || checkout.provider !== 'fake') return c.notFound();
	const back = (() => {
		const r = c.req.query('return') ?? '';
		const web = String(env(c).VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
		return web && r.startsWith(`${web}/`) ? r : `${web}${safeReturnPath('/upgrade')}`;
	})();
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Test checkout</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;background:#111;color:#eee}button,a{font:inherit;padding:.6rem 1rem;border-radius:.5rem}button{background:#0a7;color:#fff;border:0;cursor:pointer}a{color:#9cf}p[lang=ar]{direction:rtl}</style></head>
<body><main><h1>Test checkout</h1><p>No money moves. This page exists only on test environments.</p><p lang="ar" dir="rtl">دفع تجريبي: لا تُحوَّل أي أموال. هذه الصفحة موجودة في بيئات الاختبار فقط.</p>
<p>Checkout <code>${escapeHtml(checkout.id)}</code>, tier <code>${escapeHtml(checkout.tier_id)}</code>, status ${escapeHtml(checkout.status)}.</p>
<form method="post" action="/webhooks/billing/fake/checkout/${escapeHtml(checkout.id)}/pay"><input type="hidden" name="return" value="${escapeHtml(back)}">
<button type="submit" data-testid="fake-pay"${checkout.status === 'open' ? '' : ' disabled'}>Pay (test) · ادفع (تجريبي)</button></form><form method="post" action="/webhooks/billing/fake/checkout/${escapeHtml(checkout.id)}/cancel"><input type="hidden" name="return" value="${escapeHtml(back)}"><button type="submit" data-testid="fake-cancel" style="background:transparent;color:#9cf;border:1px solid #9cf">Cancel · إلغاء</button></form></main></body></html>`;
	return c.html(html, 200, { 'Cache-Control': 'no-store' });
}

/** The test page's Cancel: the checkout is left unpaid, as a provider's cancel would. */
export async function handleFakeCancel(c: Context) {
	if (!fakeAvailable(env(c))) return c.notFound();
	const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
	const web = String(env(c).VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const ret = typeof form.return === 'string' && web && form.return.startsWith(`${web}/`) ? form.return : `${web}/upgrade`;
	const id = c.req.param('id') ?? '';
	const checkout = /^bco_[0-9a-f]{32}$/.test(id) ? await readCheckout(env(c), id) : null;
	if (!checkout || checkout.provider !== 'fake') return c.notFound();
	try {
		await abandonCheckout(env(c), null, id);
		return c.redirect(ret, 303);
	} catch (error) {
		return failure(c, error, 'Test checkout cancel');
	}
}

export async function handleFakePay(c: Context) {
	if (!fakeAvailable(env(c))) return c.notFound();
	const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
	const web = String(env(c).VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const ret = typeof form.return === 'string' && web && form.return.startsWith(`${web}/`) ? form.return : `${web}/upgrade`;
	try {
		await completeFakeCheckout(env(c), c.req.param('id') ?? '');
		return c.redirect(ret, 303);
	} catch (error) {
		return failure(c, error, 'Test payment');
	}
}
