/**
 * The test rail's hosted onboarding page (wiki AUN-MEMBERS §2.4, MEM-22). QA and the local stack
 * only (SUPPORT_TEST_PROVIDERS=1 outside production); it moves no money and collects nothing.
 * A tester picks how the payee ends up; the choice goes through the same signed rail webhook →
 * queue → payee-sync path as a real rail, then the browser returns to Studio.
 *
 *   GET  /webhooks/support/rail/test/onboard/:ref?return=<web URL>
 *   POST /webhooks/support/rail/test/onboard/:ref   form: outcome=active|action_needed|sanctions, country, return
 */
import type { Context } from 'hono';
import { testAdaptersAllowed } from '../../lib/support/adapters';
import { receiveSupportWebhook, vendorContext, type SupportJobEnv } from '../../lib/support/jobs';
import { signTestRailDelivery, testRailOnboard } from '../../lib/support/test-rail';

type Env = SupportJobEnv & { VIDEOS_WEB_URL?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function safeReturn(env: Env, value: string | undefined): string {
	const web = String(env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	return web && value && value.startsWith(`${web}/`) ? value : `${web}/studio/support`;
}

export async function handleTestRailOnboardPage(c: Context) {
	const env = c.env as Env;
	if (!testAdaptersAllowed(env)) return c.notFound();
	const ref = c.req.param('ref') ?? '';
	if (!/^trpe_[0-9a-f]{24}$/.test(ref)) return c.notFound();
	const back = safeReturn(env, c.req.query('return'));
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');
	return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payout service</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;line-height:1.5}button{margin:.25rem 0;padding:.5rem 1rem}fieldset{border:1px solid #888;border-radius:.5rem}</style></head>
<body><h1>Test payout service</h1><p>No money moves here. Choose how this payout account ends up.</p><p dir="rtl" lang="ar">خدمة دفع تجريبية: لا تنتقل أي أموال هنا. اختر الحالة التي ينتهي إليها حساب استلام الدفعات.</p>
<form method="post"><input type="hidden" name="return" value="${esc(back)}"><fieldset><legend>Country / الدولة</legend><input name="country" value="GB" maxlength="2" pattern="[A-Za-z]{2}" required></fieldset>
<button name="outcome" value="active">Ready to receive payouts / جاهز لاستلام الدفعات</button><br>
<button name="outcome" value="action_needed">Needs more details / يحتاج إلى معلومات إضافية</button><br>
<button name="outcome" value="sanctions">Held by screening / موقوف بسبب الفحص</button></form></body></html>`);
}

export async function handleTestRailOnboardSubmit(c: Context) {
	const env = c.env as Env;
	if (!testAdaptersAllowed(env)) return c.notFound();
	const ref = c.req.param('ref') ?? '';
	if (!/^trpe_[0-9a-f]{24}$/.test(ref)) return c.notFound();
	const form = await c.req.parseBody();
	const outcome = String(form.outcome ?? '');
	const country = String(form.country ?? '').toUpperCase();
	if (!['active', 'action_needed', 'sanctions'].includes(outcome) || !/^[A-Z]{2}$/.test(country)) return c.text('Bad request', 400);
	const now = new Date();
	const ctx = vendorContext(env, 'test', () => now);
	await testRailOnboard(ctx, ref, outcome === 'active' ? { status: 'active', country, taxForm: country === 'US' ? 'w9' : 'w8ben' } : outcome === 'sanctions' ? { status: 'active', country, taxForm: 'w8ben', sanctions: 'hold' } : { status: 'action_needed', country, taxForm: 'none', requirements: ['bank_account', 'tax_form'] });
	const body = JSON.stringify({ id: `trev_${crypto.randomUUID()}`, createdAt: now.toISOString(), events: [{ type: 'payee.updated', railPayeeRef: ref, payeeId: null, occurredAt: now.toISOString() }] });
	await receiveSupportWebhook(env, 'rail', 'test', body, await signTestRailDelivery(body, now), now);
	return c.redirect(safeReturn(env, String(form.return ?? '')), 303);
}
