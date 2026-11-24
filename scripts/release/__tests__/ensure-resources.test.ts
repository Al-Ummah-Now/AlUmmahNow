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
			if (method === 'GET' && path.startsWith('/challenges/widgets/')) return { sitekey: TURNSTILE_SITEKEY, name: 'w', mode: 'managed', domains: ['alummahnow.net'] } as T;
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
			queues: ['al-ummah-now-errors', 'al-ummah-now-errors-dlq', 'al-ummah-now-transcode', 'al-ummah-now-transcode-dlq', 'al-ummah-now-yt-import', 'al-ummah-now-account-events', 'al-ummah-now-status-notify', 'al-ummah-cost-jobs', 'al-ummah-cost-jobs-dlq'],
			buckets: ['al-ummah-now-sourcemaps', 'al-ummah-now-media', 'al-ummah-now-media-private', 'al-ummah-now-media-originals', 'al-ummah-now-csam-evidence'],
			placeholderSecrets: { [SECRETS_STORE_ID]: ['google-oauth-client-secret'] },
			turnstileHostnames: { sitekey: TURNSTILE_SITEKEY, hostnames: ['alummahnow.net', 'www.alummahnow.net'] },
		});
		assert.deepEqual(resourcesFor('qa').turnstileHostnames?.hostnames, ['qa.alummahnow.net', 'www.qa.alummahnow.net']);
		assert.deepEqual(resourcesFor('stage').turnstileHostnames?.hostnames, ['stage.alummahnow.net', 'www.stage.alummahnow.net']);
		assert.deepEqual(resourcesFor('qa').queues, ['al-ummah-now-errors-qa', 'al-ummah-now-errors-dlq-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa', 'al-ummah-now-yt-import-qa', 'al-ummah-now-account-events-qa', 'al-ummah-now-status-notify-qa', 'al-ummah-cost-jobs-qa', 'al-ummah-cost-jobs-dlq-qa']);
		assert.deepEqual(resourcesFor('stage').buckets, ['al-ummah-now-sourcemaps-stage', 'al-ummah-now-media-stage', 'al-ummah-now-media-private-stage', 'al-ummah-now-media-originals-stage', 'al-ummah-now-csam-evidence-stage']);
	});

	it('creates only what is missing', async () => {
		const { cf, calls } = fakeCf(['al-ummah-now-errors-qa', 'al-ummah-now-transcode-qa', 'al-ummah-now-transcode-dlq-qa', 'al-ummah-now-yt-import-qa', 'al-ummah-now-account-events-qa', 'al-ummah-now-status-notify-qa', 'al-ummah-cost-jobs-qa', 'al-ummah-cost-jobs-dlq-qa'], ['al-ummah-now-media-qa', 'al-ummah-now-media-private-qa', 'al-ummah-now-media-originals-qa', 'al-ummah-now-csam-evidence-qa']);
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

	describe('Turnstile hostnames', () => {
		function widgetCf(widget: Record<string, unknown> | Error) {
			const calls: { method: string; path: string; body?: unknown }[] = [];
			const cf: CfClient = {
				accountId: 'a',
				async request<T>(method: string, path: string, body?: unknown): Promise<T> {
					calls.push({ method, path, body });
					if (!path.startsWith('/challenges/')) return [] as T;
					if (widget instanceof Error) throw widget;
					return (method === 'GET' ? widget : {}) as T;
				},
			};
			return { cf, calls };
		}
		const base = { sitekey: TURNSTILE_SITEKEY, name: 'al-ummah-now-production', mode: 'managed', clearance_level: 'no_clearance', bot_fight_mode: false, region: 'world', offlabel: false, secret: 'never-sent', created_on: 'x' };

		it('a domain covers itself and its subdomains, nothing else', () => {
			assert.ok(coveredBy('www.qa.alummahnow.net', 'alummahnow.net'));
			assert.ok(coveredBy('alummahnow.net', 'AlUmmahNow.net'));
			assert.ok(!coveredBy('alummahnow.net', 'www.alummahnow.net'));
			assert.ok(!coveredBy('evilalummahnow.net', 'alummahnow.net'));
		});

		it('changes nothing when every host is covered', async () => {
			const { cf, calls } = widgetCf({ ...base, domains: ['alummahnow.net', 'alummahnow.org'] });
			assert.deepEqual(await ensureTurnstileHostnames(cf, TURNSTILE_SITEKEY, ['qa.alummahnow.net', 'www.qa.alummahnow.net']), {
				added: [],
				covered: [{ host: 'qa.alummahnow.net', by: 'alummahnow.net' }, { host: 'www.qa.alummahnow.net', by: 'alummahnow.net' }],
			});
			assert.deepEqual(calls.map((c) => c.method), ['GET']);
		});

		it('appends the missing hosts, keeps every listed domain and setting, never sends the secret', async () => {
			const { cf, calls } = widgetCf({ ...base, domains: ['alummahnow.org', 'alummahnow.com'] });
			const { added, covered } = await ensureTurnstileHostnames(cf, TURNSTILE_SITEKEY, ['stage.alummahnow.net', 'www.stage.alummahnow.net']);
			assert.deepEqual(added, ['stage.alummahnow.net', 'www.stage.alummahnow.net']);
			assert.deepEqual(covered, []);
			assert.equal(calls[1]!.method, 'PUT');
			assert.equal(calls[1]!.path, `/challenges/widgets/${TURNSTILE_SITEKEY}`);
			assert.deepEqual(calls[1]!.body, {
				domains: ['alummahnow.org', 'alummahnow.com', 'stage.alummahnow.net', 'www.stage.alummahnow.net'],
				name: 'al-ummah-now-production', mode: 'managed', bot_fight_mode: false, clearance_level: 'no_clearance', offlabel: false, region: 'world',
			});
		});

		it('is idempotent: a second run after the append is a no-op', async () => {
			const { cf, calls } = widgetCf({ ...base, domains: ['alummahnow.org', 'stage.alummahnow.net', 'www.stage.alummahnow.net'] });
			assert.deepEqual((await ensureTurnstileHostnames(cf, TURNSTILE_SITEKEY, ['stage.alummahnow.net', 'www.stage.alummahnow.net'])).added, []);
			assert.equal(calls.length, 1);
		});

		it('logs each covered host with the domain that covers it, and the added ones', async () => {
			const lines: string[] = [];
			const { cf } = widgetCf({ ...base, domains: ['alummahnow.net', 'qa.alummahnow.org'] });
			const wanted = { queues: [], buckets: [], turnstileHostnames: { sitekey: TURNSTILE_SITEKEY, hostnames: ['www.qa.alummahnow.net', 'www.qa.alummahnow.org', 'x.example'] } };
			const { created } = await ensureResources(cf, wanted, (l) => lines.push(l));
			assert.deepEqual(created, ['turnstile x.example']);
			assert.deepEqual(lines, [
				`Turnstile widget ${TURNSTILE_SITEKEY} already allows www.qa.alummahnow.net (covered by alummahnow.net)`,
				`Turnstile widget ${TURNSTILE_SITEKEY} already allows www.qa.alummahnow.org (covered by qa.alummahnow.org)`,
				`Turnstile widget ${TURNSTILE_SITEKEY} now allows x.example`,
			]);
		});

		it('a token without Turnstile access warns with the permission and ensures the rest', async () => {
			const lines: string[] = [];
			const { cf } = widgetCf(new CfApiError(403, 'GET /challenges/widgets/x -> 403 10000: Authentication error'));
			const { created } = await ensureResources(cf, { queues: [], buckets: [], turnstileHostnames: { sitekey: TURNSTILE_SITEKEY, hostnames: ['qa.alummahnow.net'] } }, (l) => lines.push(l));
			assert.deepEqual(created, []);
			assert.match(lines.join('\n'), /::warning::Turnstile hostnames not checked .*Account > Turnstile > Edit/);
		});

		it('any other error fails the run', async () => {
			const { cf } = widgetCf(new CfApiError(500, 'boom'));
			await assert.rejects(ensureResources(cf, { queues: [], buckets: [], turnstileHostnames: { sitekey: TURNSTILE_SITEKEY, hostnames: ['qa.alummahnow.net'] } }, () => undefined), /boom/);
		});
	});
});
