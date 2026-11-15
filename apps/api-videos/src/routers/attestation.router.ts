/**
 * Native app attestation endpoints (lib/attestation/service.ts, AlUmmahNow#1274, NAT-REL).
 * Public (the apps call them before and after sign-in); each POST is rate limited per IP / user.
 * While a platform is off in videos admin → Mobile apps, its endpoints answer 404 attestation_off.
 *
 *   GET  /api/apps/attestation/config           what the apps should do
 *   POST /api/apps/attestation/challenge        a one-time challenge (5 min)
 *   POST /api/apps/attestation/apple/register   App Attest attestation → proof
 *   POST /api/apps/attestation/apple/assert     App Attest assertion   → proof
 *   POST /api/apps/attestation/android          Play Integrity token    → proof
 */
import { Hono, type Context } from 'hono';
import { publicAttestationConfig } from '@al-ummah/shared-types';
import { edgeRateLimit } from '../middleware/bot-protection';
import {
	assertAppleKey,
	issueChallenge,
	loadMobileAppsSettings,
	registerAppleKey,
	verifyAndroid,
	type AttestationEnv,
	type AttestOutcome,
} from '../lib/attestation/service';

const router = new Hono<{ Bindings: AttestationEnv }>();

router.use('*', edgeRateLimit('ATTEST_LIMITER', 'videos.attestation'));

const off = (c: Context) => c.json({ success: false, code: 'attestation_off', error: 'App attestation is not turned on.' }, 404);

async function body(c: Context): Promise<Record<string, unknown>> {
	try {
		const value = await c.req.json();
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function answer(c: Context, outcome: AttestOutcome) {
	if ('proof' in outcome) return c.json({ success: true, result: { proof: outcome.proof, expiresAt: outcome.expiresAt } });
	return c.json({ success: false, code: outcome.code }, outcome.status);
}

router.get('/config', async (c) => {
	const config = publicAttestationConfig(await loadMobileAppsSettings(c.env));
	return c.json({ success: true, result: config }, 200, { 'Cache-Control': 'public, max-age=60' });
});

router.post('/challenge', async (c) => {
	const config = publicAttestationConfig(await loadMobileAppsSettings(c.env));
	if (!config.apple.enabled && !config.android.enabled) return off(c);
	if (!c.env.HUMAN_VERIFIED) return c.json({ success: false, code: 'unavailable' }, 503);
	return c.json({ success: true, result: await issueChallenge(c.env.HUMAN_VERIFIED) });
});

router.post('/apple/register', async (c) => {
	const settings = await loadMobileAppsSettings(c.env);
	if (!publicAttestationConfig(settings).apple.enabled) return off(c);
	if (!c.env.HUMAN_VERIFIED) return c.json({ success: false, code: 'unavailable' }, 503);
	return answer(c, await registerAppleKey(c.env, settings, await body(c)));
});

router.post('/apple/assert', async (c) => {
	const settings = await loadMobileAppsSettings(c.env);
	if (!publicAttestationConfig(settings).apple.enabled) return off(c);
	if (!c.env.HUMAN_VERIFIED) return c.json({ success: false, code: 'unavailable' }, 503);
	return answer(c, await assertAppleKey(c.env, settings, await body(c)));
});

router.post('/android', async (c) => {
	const settings = await loadMobileAppsSettings(c.env);
	if (!publicAttestationConfig(settings).android.enabled) return off(c);
	if (!c.env.HUMAN_VERIFIED) return c.json({ success: false, code: 'unavailable' }, 503);
	return answer(c, await verifyAndroid(c.env, settings, await body(c)));
});

export default router;
