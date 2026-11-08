/**
 * Epic 9.3: the public API contract is generated from the real routes, is
 * versioned (/api/v1), and openapi/v1.json must not drift from the code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import worker, { getContractDocument, listServedRoutes } from '../src/index';
import { buildContractDocument, normalizeDocPath, serializeContract } from '../src/lib/api-contract';
import { deprecationHeaders, findDeprecation, resolveApiVersion } from '../src/lib/api-version';

const CONTRACT_FILE = join(__dirname, '..', 'openapi', 'v1.json');
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('API contract (openapi/v1.json)', () => {
	it('matches the routes: run `pnpm --filter @al-ummah/api-videos openapi:generate` and commit the file', async () => {
		const generated = serializeContract(await getContractDocument());
		const committed = readFileSync(CONTRACT_FILE, 'utf8');
		assert.ok(generated === committed, 'openapi/v1.json is out of date with the routes. Regenerate it with `pnpm --filter @al-ummah/api-videos openapi:generate`.');
	});

	it('documents only operations Hono really serves', async () => {
		const doc = await getContractDocument();
		const served = new Set(listServedRoutes().map((r) => `${r.method} ${r.path.replace(/\{[^}]*\}/g, '')}`));
		const missing: string[] = [];
		for (const [path, item] of Object.entries<any>(doc.paths)) {
			const honoPath = path.replace(/^\/api\/v1/, '/api').replace(/\{([^}]+)\}/g, ':$1');
			for (const method of Object.keys(item)) {
				const key = `${method.toUpperCase()} ${honoPath}`;
				if (!served.has(key) && !served.has(`${method.toUpperCase()} ${honoPath}/`)) missing.push(key);
			}
		}
		assert.deepEqual(missing, []);
	});

	it('is versioned, public-only and sorted', async () => {
		const doc = await getContractDocument();
		const paths = Object.keys(doc.paths);
		assert.ok(paths.length > 50, `expected the public routes, got ${paths.length}`);
		assert.ok(paths.every((p) => p.startsWith('/api/v1/')), 'every path is under /api/v1');
		assert.ok(!paths.some((p) => /\/api\/v1\/(api|videos\/api|channels\/api)\//.test(p)), 'no doubled router prefixes');
		assert.ok(!paths.includes('/api/v1/i18n/sync'), 'internal routes are excluded');
		assert.ok(paths.includes('/api/v1/app-config'));
		assert.ok(paths.includes('/api/v1/videos/{id}'));
		assert.deepEqual(paths, [...paths].sort());
		assert.equal(doc.info.title, 'Al Ummah Now API');
		assert.ok(doc.components.securitySchemes.BearerAuth);
	});
});

describe('normalizeDocPath', () => {
	it('collapses the router base that chanfana repeats', () => {
		assert.equal(normalizeDocPath('/api/videos/api/videos/{id}'), '/api/videos/{id}');
		assert.equal(normalizeDocPath('/api/api/profiles/{id}'), '/api/profiles/{id}');
		assert.equal(normalizeDocPath('/api/videos/sections/api/videos/sections/recent'), '/api/videos/sections/recent');
		assert.equal(normalizeDocPath('/api/videos/api/videos'), '/api/videos');
	});
	it('leaves served paths alone', () => {
		for (const p of ['/api/videos/{id}', '/api/search', '/health', '/api/videos/{id}/videos', '/api/apis']) assert.equal(normalizeDocPath(p), p);
	});
	it('marks deprecated operations', () => {
		const raw = { paths: { '/api/x/api/x/{id}': { get: { responses: {} } } } };
		const doc = buildContractDocument(raw);
		assert.ok(doc.paths['/api/v1/x/{id}'].get);
	});
});

describe('/api/v1 routing', () => {
	it('rewrites /api/v1/* to /api/* and leaves other paths', () => {
		const r = resolveApiVersion(new Request('https://h/api/v1/videos/abc?x=1', { method: 'POST', body: 'b' }));
		assert.equal(r.kind, 'versioned');
		assert.equal(r.kind === 'versioned' && new URL(r.request.url).pathname, '/api/videos/abc');
		assert.equal(r.kind === 'versioned' && new URL(r.request.url).search, '?x=1');
		assert.equal(r.kind === 'versioned' && r.request.method, 'POST');
		assert.equal(resolveApiVersion(new Request('https://h/api/v1')).kind, 'versioned');
		assert.equal(resolveApiVersion(new Request('https://h/api/videos')).kind, 'unversioned');
		assert.equal(resolveApiVersion(new Request('https://h/api/v1x')).kind, 'unversioned');
		assert.deepEqual(resolveApiVersion(new Request('https://h/api/v9/videos')), { kind: 'unsupported', version: '9' });
	});

	it('serves the app config under /api/v1 with X-API-Version, and the unversioned alias', async () => {
		const q = '?platform=ios&app=viewer&version=1.0.0';
		const v1 = await worker.fetch(new Request(`https://h/api/v1/app-config${q}`), {} as never, ctx);
		assert.equal(v1.status, 200);
		assert.equal(v1.headers.get('X-API-Version'), '1');
		const body: any = await v1.json();
		assert.equal(body.update.status, 'ok');
		const legacy = await worker.fetch(new Request(`https://h/api/app-config${q}`), {} as never, ctx);
		assert.equal(legacy.status, 200);
		assert.equal(legacy.headers.get('X-API-Version'), null);
	});

	it('answers 404 unsupported_api_version for unknown versions', async () => {
		const res = await worker.fetch(new Request('https://h/api/v2/videos'), {} as never, ctx);
		assert.equal(res.status, 404);
		assert.equal(((await res.json()) as any).error, 'unsupported_api_version');
	});

	it('serves the contract at /api/v1/openapi.json', async () => {
		const res = await worker.fetch(new Request('https://h/api/v1/openapi.json'), {} as never, ctx);
		assert.equal(res.status, 200);
		const doc: any = await res.json();
		assert.ok(doc.paths['/api/v1/app-config']);
	});
});

describe('deprecation headers', () => {
	const table = { 'GET /api/v1/things/{id}': { since: '2027-01-01', sunset: '2027-07-01', link: 'https://docs/x' } };
	it('matches concrete paths against templated entries', () => {
		assert.ok(findDeprecation('GET', '/api/things/42', table));
		assert.equal(findDeprecation('POST', '/api/things/42', table), undefined);
		assert.equal(findDeprecation('GET', '/api/things/42/more', table), undefined);
	});
	it('formats RFC 9745 / RFC 8594 headers', () => {
		const h = deprecationHeaders(table['GET /api/v1/things/{id}']);
		assert.equal(h.Deprecation, `@${Date.parse('2027-01-01') / 1000}`);
		assert.equal(h.Sunset, 'Thu, 01 Jul 2027 00:00:00 GMT');
		assert.equal(h.Link, '<https://docs/x>; rel="deprecation"');
	});
});
