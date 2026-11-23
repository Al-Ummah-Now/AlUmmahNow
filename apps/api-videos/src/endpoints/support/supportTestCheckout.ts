/**
 * The test collector's hosted checkout page (wiki AUN-MEMBERS §2.1, MEM-7). QA and the local stack only
 * (SUPPORT_TEST_PROVIDERS=1 outside production); no card is asked for and no money moves. "Pay (test)"
 * sends signed collector events through the same webhook → queue → ledger path as a real collector,
 * then the browser returns to the videos site; "Cancel" leaves the checkout unpaid.
 *
 *   GET  /webhooks/support/test/checkout/:id
 *   POST /webhooks/support/test/checkout/:id   form: action=pay|cancel
 */
import type { Context } from 'hono';
import { money, formatSupportMoney } from '@al-ummah/shared-types';
import { testAdaptersAllowed } from '../../lib/support/adapters';
import { receiveSupportWebhook, vendorContext, type SupportJobEnv } from '../../lib/support/jobs';
import { signTestDelivery, testPay } from '../../lib/support/test-collector';

type Env = SupportJobEnv & { VIDEOS_WEB_URL?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const ID = /^sco_[0-9a-f]{32}$/;

async function checkout(env: Env, id: string) {
	if (!ID.test(id) || !env.SEARCH_DB) return null;
	return env.SEARCH_DB.prepare('SELECT id, kind, charged, currency, status, collector FROM support_checkouts WHERE id = ?').bind(id).first<{ id: string; kind: 'one_time' | 'monthly'; charged: number; currency: string; status: string; collector: string }>();
}

async function returnUrl(env: Env, id: string): Promise<string> {
	const stored = await vendorContext(env, 'test').testState?.get<{ returnUrl?: string }>(`collector:checkout:${id}`);
	const web = String(env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	return web && stored?.returnUrl?.startsWith(`${web}/`) ? stored.returnUrl : `${web}/`;
}

export async function handleTestCheckoutPage(c: Context) {
	const env = c.env as Env;
	if (!testAdaptersAllowed(env)) return c.notFound();
	const co = await checkout(env, c.req.param('id') ?? '');
	if (!co || co.collector !== 'test') return c.notFound();
	const amount = money(co.charged, co.currency);
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');
	return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;line-height:1.5}button{margin:.25rem .25rem .25rem 0;padding:.5rem 1rem}</style></head>
<body><h1>Test checkout</h1><p>No card is asked for and no money moves.</p><p dir="rtl" lang="ar">دفع تجريبي: لا تُطلب بطاقة ولا تنتقل أي أموال.</p>
<p><strong>${esc(formatSupportMoney('en', amount))}</strong> · <span dir="rtl" lang="ar">${esc(formatSupportMoney('ar', amount))}</span> · ${co.kind === 'monthly' ? 'every month / كل شهر' : 'once / مرة واحدة'}</p>
<form method="post"><button name="action" value="pay">Pay (test) / ادفع (تجريبي)</button><button name="action" value="cancel">Cancel / إلغاء</button></form></body></html>`);
}

export async function handleTestCheckoutSubmit(c: Context) {
	const env = c.env as Env;
	if (!testAdaptersAllowed(env)) return c.notFound();
	const id = c.req.param('id') ?? '';
	const co = await checkout(env, id);
	if (!co || co.collector !== 'test') return c.notFound();
	const form = await c.req.parseBody();
	const back = await returnUrl(env, id);
	if (form.action === 'cancel') {
		await env.SEARCH_DB!.prepare("UPDATE support_checkouts SET status = 'expired' WHERE id = ? AND status = 'open'").bind(id).run();
		return c.redirect(back, 303);
	}
	if (form.action !== 'pay' || co.status !== 'open') return c.redirect(back, 303);
	const now = new Date();
	const country = ((c.req.raw as { cf?: { country?: unknown } }).cf?.country as string | undefined) ?? null;
	const paid = await testPay(vendorContext(env, 'test', () => now), { checkoutId: id, kind: co.kind, charged: money(co.charged, co.currency), supporterCountry: country });
	const body = JSON.stringify({ id: paid.eventId, createdAt: now.toISOString(), events: paid.events });
	await receiveSupportWebhook(env, 'collector', 'test', body, await signTestDelivery(body, now), now);
	return c.redirect(back, 303);
}
