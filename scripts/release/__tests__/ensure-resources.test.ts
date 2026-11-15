import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CfApiError, type CfClient } from '../cf-api.ts';
import { coveredBy, ensureResources, ensureTurnstileHostnames, resourcesFor, SECRETS_STORE_ID, TURNSTILE_SITEKEY } from '../ensure-resources.ts';

function fakeCf(queues: string[], buckets: string[], lifecycle: Record<string, unknown[]> = {}, secrets: string[] = ['google-oauth-client-secret', 'google-oauth-client-secret-qa', 'google-oauth-client-secret-stage']) {
	const calls: string[] = [];
	const cf: CfClient = {
		accountId: 'a',
		async request<T>(method: string, path: string, body?: unknown): Promise<T> {
			calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
			if (method === 'GET' && path.startsWith('/secrets_store/')) return secrets.map((name) => ({ name })) as T;
			if (method === 'GET' && path.startsWith('/queues')) return queues.map((queue_name) => ({ queue_name })) as T;
			if (method === 'GET' && path.endsWith('/lifecycle')) return { rules: lifecycle[decodeURIComponent(path.split('/')[3])] ?? [] } as T;
			if (method === 'GET' && path.startsWith('/r2/buckets/')) {
				if (buckets.includes(decodeURIComponent(path.slice('/r2/buckets/'.length)))) return {} as T;
				throw new CfApiError(404, 'not found');
			}
			return {} as T;
		},
	};
	return { cf, calls };
}

describe('ensure-resources', () => {
	it('names each environment', () => {
		assert.deepEqual(resourcesFor('production'), {
			queues: ['al-ummah-now-errors', 'al-ummah-now-errors-dlq', 'al-ummah-now-transcode', 'al-ummah-now-transcode-dlq', 'al-ummah-now-yt-import'],
			buckets: ['al-ummah-now-sourcemaps', 'al-ummah-now-media', 'al-ummah-now-media-private', 'al-ummah-now-media-originals', 'al-ummah-now-csam-evidence'],
			placeholderSecrets: { [SECRETS_STORE_ID]: ['google-oauth-client-secret'] },
			turnstile: { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.alummahnow.net'] },
		});
		assert.deepEqual(resourcesFor('stage').turnstile?.hostnames, ['www.stage.alummahnow.net']);
		assert.deepEqual(resourcesFor('qa').turnstile?.hostnames, ['www.qa.alummahnow.net']);
		assert.deepEqual(resourcesFor('qa').queues, ['al-ummah-now-errors-qa', 'al-ummah-now-errors-dlq-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa', 'al-ummah-now-yt-import-qa']);
		assert.deepEqual(resourcesFor('stage').buckets, ['al-ummah-now-sourcemaps-stage', 'al-ummah-now-media-stage', 'al-ummah-now-media-private-stage', 'al-ummah-now-media-originals-stage', 'al-ummah-now-csam-evidence-stage']);
	});

	it('creates only what is missing', async () => {
		const { cf, calls } = fakeCf(['al-ummah-now-errors-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa', 'al-ummah-now-yt-import-qa'], ['al-ummah-now-media-qa', 'al-ummah-now-media-private-qa', 'al-ummah-now-media-originals-qa', 'al-ummah-now-csam-evidence-qa']);
		const { created } = await ensureResources(cf, resourcesFor('qa'), () => undefined);
		assert.deepEqual(created, ['queue al-ummah-now-errors-dlq-qa', 'bucket al-ummah-now-sourcemaps-qa', 'lifecycle al-ummah-now-sourcemaps-qa 14d']);
		assert.ok(calls.includes('POST /queues {"queue_name":"al-ummah-now-errors-dlq-qa"}'));
		assert.ok(calls.includes('POST /r2/buckets {"name":"al-ummah-now-sourcemaps-qa"}'));
	});

	it('creates a missing Secrets Store placeholder, never touches an existing secret', async () => {
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets, {}, ['google-oauth-client-secret']);
		const { created } = await ensureResources(cf, { ...resourcesFor('stage'), expireAfterDays: undefined }, () => undefined);
		assert.deepEqual(created, ['secret google-oauth-client-secret-stage (placeholder)']);
		const post = calls.find((c) => c.startsWith('POST /secrets_store/'))!;
		assert.ok(post.startsWith(`POST /secrets_store/stores/${SECRETS_STORE_ID}/secrets `));
		assert.deepEqual(JSON.parse(post.slice(post.indexOf('['))), [{ name: 'google-oauth-client-secret-stage', value: 'unset', scopes: ['workers'], comment: 'Placeholder: paste the real value over it' }]);
		assert.equal(calls.filter((c) => c.startsWith('PUT /secrets_store') || c.startsWith('PATCH')).length, 0);
		assert.deepEqual(resourcesFor('production').placeholderSecrets, { [SECRETS_STORE_ID]: ['google-oauth-client-secret'] });
	});

	it('changes nothing when everything exists', async () => {
		const expiry = { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86_400 } } };
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets, { 'al-ummah-now-sourcemaps-stage': [expiry] });
		const { created } = await ensureResources(cf, resourcesFor('stage'), () => undefined);
		assert.deepEqual(created, []);
		assert.equal(calls.filter((c) => c.startsWith('POST')).length, 0);
	});

	it('expires QA and stage source maps (14 and 30 days), never production ones', async () => {
		assert.deepEqual(resourcesFor('qa').expireAfterDays, { 'al-ummah-now-sourcemaps-qa': 14 });
		assert.deepEqual(resourcesFor('stage').expireAfterDays, { 'al-ummah-now-sourcemaps-stage': 30 });
		assert.equal(resourcesFor('production').expireAfterDays, undefined);
		const other = { id: 'someone-else', enabled: true, conditions: { prefix: 'tmp/' } };
		const { cf, calls } = fakeCf(resourcesFor('qa').queues, resourcesFor('qa').buckets, { 'al-ummah-now-sourcemaps-qa': [other] });
		const { created } = await ensureResources(cf, resourcesFor('qa'), () => undefined);
		assert.deepEqual(created, ['lifecycle al-ummah-now-sourcemaps-qa 14d']);
		const put = calls.find((c) => c.startsWith('PUT /r2/buckets/al-ummah-now-sourcemaps-qa/lifecycle'))!;
		const body = JSON.parse(put.slice(put.indexOf('{')));
		assert.deepEqual(body.rules[0], other, 'an existing rule is kept');
		assert.deepEqual(body.rules[1], { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 14 * 86_400 } } });
	});

	it('leaves a matching rule alone', async () => {
		const rule = { id: 'al-ummah-expire', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86_400 } } };
		const { cf, calls } = fakeCf(resourcesFor('stage').queues, resourcesFor('stage').buckets, { 'al-ummah-now-sourcemaps-stage': [rule] });
		await ensureResources(cf, resourcesFor('stage'), () => undefined);
		assert.equal(calls.filter((c) => c.startsWith('PUT')).length, 0);
	});

	it('refuses a lifecycle rule on CSAM evidence', async () => {
		const { cf } = fakeCf([], ['al-ummah-now-csam-evidence-qa']);
		await assert.rejects(ensureResources(cf, { queues: [], buckets: [], expireAfterDays: { 'al-ummah-now-csam-evidence-qa': 1 } }, () => undefined), /never gets a lifecycle rule/);
	});
});

function fakeWidget(widget: Record<string, unknown>) {
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const cf: CfClient = {
		accountId: 'a',
		async request<T>(method: string, path: string, body?: unknown): Promise<T> {
			calls.push({ method, path, body });
			if (method === 'GET') return structuredClone(widget) as T;
			return {} as T;
		},
	};
	return { cf, calls };
}

describe('ensure-resources: Turnstile hostnames', () => {
	const widget = { sitekey: TURNSTILE_SITEKEY, name: 'Al Ummah Now', domains: ['alummahnow.org', 'videos.alummahnow.net'], mode: 'managed', bot_fight_mode: false, clearance_level: 'no_clearance', offlabel: false, region: 'world', created_on: 'x' };

	it('appends a missing host and sends back every setting the widget had', async () => {
		const { cf, calls } = fakeWidget(widget);
		const { added } = await ensureTurnstileHostnames(cf, { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.qa.alummahnow.net'] }, () => undefined);
		assert.deepEqual(added, ['www.qa.alummahnow.net']);
		const put = calls.find((c) => c.method === 'PUT')!;
		assert.equal(put.path, `/challenges/widgets/${encodeURIComponent(TURNSTILE_SITEKEY)}`);
		assert.deepEqual(put.body, {
			name: 'Al Ummah Now',
			domains: ['alummahnow.org', 'videos.alummahnow.net', 'www.qa.alummahnow.net'],
			mode: 'managed',
			bot_fight_mode: false,
			clearance_level: 'no_clearance',
			offlabel: false,
			region: 'world',
		});
	});

	it('never removes a domain and changes nothing when the host is there (idempotent)', async () => {
		const { cf, calls } = fakeWidget({ ...widget, domains: [...widget.domains, 'www.alummahnow.net'] });
		const { added } = await ensureTurnstileHostnames(cf, { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.alummahnow.net'] }, () => undefined);
		assert.deepEqual(added, []);
		assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
	});

	it('a parent domain already covers its subdomains', async () => {
		assert.equal(coveredBy(['alummahnow.net'], 'www.stage.alummahnow.net'), 'alummahnow.net');
		assert.equal(coveredBy(['WWW.alummahnow.net'], 'www.alummahnow.net'), 'WWW.alummahnow.net');
		assert.equal(coveredBy(['notalummahnow.net', 'alummahnow.org'], 'www.alummahnow.net'), undefined);
		const { cf, calls } = fakeWidget({ ...widget, domains: ['alummahnow.net'] });
		const lines: string[] = [];
		const { added } = await ensureTurnstileHostnames(cf, { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.stage.alummahnow.net'] }, (l) => lines.push(l));
		assert.deepEqual(added, []);
		assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
		assert.match(lines[0]!, /covered by alummahnow\.net/);
	});

	it('a token without Turnstile access fails the call (the CLI turns it into a warning naming the permission)', async () => {
		const cf: CfClient = { accountId: 'a', async request() { throw new CfApiError(403, 'GET /challenges/widgets -> 403 Authentication error'); } };
		await assert.rejects(ensureTurnstileHostnames(cf, { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.alummahnow.net'] }, () => undefined), (e: unknown) => e instanceof CfApiError && e.status === 403);
	});
});
