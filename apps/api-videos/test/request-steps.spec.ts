/** Where a slow request's time went (shared-types request-steps): bindings and fetches counted and timed, nothing else changed. */
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resetRequestSteps, runWithSteps, stepSummary, timedBindings, timeStep } from '@al-ummah/shared-types/request-steps';

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The runtime's classes by name; private fields fail on a Proxy `this`, as the native ones do. */
class D1PreparedStatement {
	#db: D1Database;
	params: unknown[];
	constructor(db: D1Database, readonly statement: string, params: unknown[] = []) {
		this.#db = db;
		this.params = params;
	}
	bind(...params: unknown[]) {
		return new D1PreparedStatement(this.#db, this.statement, params);
	}
	async first() {
		await wait(5);
		return { sql: this.statement, params: this.params };
	}
	async all() {
		return { results: [await this.first()] };
	}
	async run() {
		throw new Error('D1 down');
	}
	native() {
		return this.#db.name;
	}
}
class D1Database {
	#name = 'search';
	get name() {
		return this.#name;
	}
	prepare(sql: string) {
		return new D1PreparedStatement(this, sql);
	}
	async batch(list: D1PreparedStatement[]) {
		return list.map((s) => s.native());
	}
	withSession() {
		return this;
	}
}
class R2Bucket {
	#store = new Map([['a', 'A']]);
	async get(key: string) {
		await wait(5);
		return this.#store.get(key) ?? null;
	}
	async head(key: string) {
		return this.#store.has(key);
	}
	createMultipartUpload() {
		return [...this.#store.keys()];
	}
}
class KvNamespace {
	#value = 'v';
	get() {
		return Promise.resolve(this.#value);
	}
}
class Fetcher {
	#n = 0;
	async fetch() {
		return new Response(String(++this.#n));
	}
	anyRpc(x: number) {
		return x + 1;
	}
}

const bindings = () => ({ SEARCH_DB: new D1Database(), videos: new R2Bucket(), KV: new KvNamespace(), MEDIA: new Fetcher(), text: 'x', secret: { get: async () => 's' }, map: new Map([['k', 1]]) });

describe('request steps', () => {
	beforeEach(() => resetRequestSteps());

	it('reads through to the live env: a value, limiter or binding changed later is seen', async () => {
		const env = { ...bindings(), FLAG: 'on', LIMITER: undefined as unknown, kvNull: null } as any;
		const t = timedBindings(env) as any;
		assert.deepEqual([t.FLAG, t.LIMITER, t.kvNull, 'LATER' in t], ['on', undefined, null, false]);
		const limiter = { limit: async () => ({ success: false }) };
		env.FLAG = 'off';
		env.LIMITER = limiter;
		env.LATER = 1;
		assert.deepEqual([t.FLAG, t.LIMITER === limiter, t.LATER, { ...t }.LATER], ['off', true, 1, 1], 'a limiter is the env’s own');
		const [name, first] = Object.entries(env).find(([, v]) => v instanceof R2Bucket) as [string, R2Bucket];
		assert.equal(await t[name].get('a'), 'A');
		assert.equal(t[name], t[name], 'one wrapper per binding');
		const before = t[name];
		env[name] = new R2Bucket();
		assert.notEqual(t[name], before);
		env[name] = first;
		assert.equal(t[name], before);
		first.get = async () => 'changed';
		assert.equal(await t[name].get('a'), 'changed', 'a method replaced on the binding');
		delete env.FLAG;
		assert.equal('FLAG' in t, false);
		t.SET = 'through';
		assert.equal(env.SET, 'through');
		assert.equal((timedBindings(Object.freeze({ B: first })) as any).B, first, 'a locked property answers its own value');
	});

	it('counts and times each binding, and changes no answer', async () => {
		const env = bindings();
		const t = timedBindings(env) as any;
		assert.equal(timedBindings(env), t, 'one wrapper per env: caches keyed by a binding keep working');
		assert.deepEqual([t.text, t.secret, t.map], [env.text, env.secret, env.map]);
		const summary = await runWithSteps(async () => {
			assert.deepEqual(await t.SEARCH_DB.prepare('SELECT ?').bind(1).first(), { sql: 'SELECT ?', params: [1] });
			assert.deepEqual((await t.SEARCH_DB.withSession('first-primary').prepare('SELECT 2').all()).results.length, 1);
			assert.deepEqual(await t.SEARCH_DB.batch([t.SEARCH_DB.prepare('a').bind(1), t.SEARCH_DB.prepare('b')]), ['search', 'search'], 'batch gets the native statements');
			assert.equal(await t.videos.get('a'), 'A');
			assert.equal(await t.videos.get('b'), null);
			assert.equal(await t.videos.head('a'), true);
			assert.deepEqual(t.videos.createMultipartUpload(), ['a']);
			assert.equal(await t.KV.get('x'), 'v');
			assert.equal(await (await t.MEDIA.fetch('https://x')).text(), '1');
			assert.equal(t.MEDIA.anyRpc(1), 2);
			return stepSummary()!;
		});
		for (const part of [/d1:SEARCH_DB 3x \d+ms \(max \d+\)/, /r2:videos 3x/, /kv:KV 1x/, /service:MEDIA 1x/]) assert.match(summary.steps, part);
		assert.ok(summary.waitMs >= 15, JSON.stringify(summary));
	});

	it('an error is passed on and still counted', async () => {
		const t = timedBindings(bindings()) as any;
		await runWithSteps(async () => {
			await assert.rejects(t.SEARCH_DB.prepare('x').run(), /D1 down/);
			assert.throws(() => timeStep('sync', () => { throw new Error('now'); }), /now/);
			assert.match(stepSummary()!.steps, /d1:SEARCH_DB 1x/);
			assert.match(stepSummary()!.steps, /sync 1x/);
		});
	});

	it('waitMs counts calls at once only once; the totals show both', async () => {
		const s = await runWithSteps(async () => {
			await Promise.all([timeStep('a', () => wait(40)), timeStep('b', () => wait(40))]);
			return stepSummary()!;
		});
		assert.ok(s.waitMs >= 35 && s.waitMs < 75, JSON.stringify(s));
		assert.match(s.steps, /a 1x \d+ms, b 1x|b 1x \d+ms, a 1x/);
	});

	it('only the first request of the isolate is cold; runs do not mix', async () => {
		const one = async (kind: string) => runWithSteps(async () => {
			await timeStep(kind, () => wait(5));
			return stepSummary()!;
		});
		const [a, b] = await Promise.all([one('a'), one('b')]);
		assert.deepEqual([a.cold, b.cold, a.steps.startsWith('a 1x'), b.steps.startsWith('b 1x')], [true, false, true, true]);
		assert.ok(!a.steps.includes('b 1x'));
		assert.ok((await one('c')).ageMs >= 0);
	});

	it('fetches are named by host and templated path, never the query', async () => {
		const real = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => new Response('ok')) as never;
		try {
			const s = await runWithSteps(async () => {
				await fetch('https://api.example/api/videos/9a66ebfa-a5c7-47d1-a2ac-2708ce3d6d4a?token=SECRET');
				await fetch(new Request('https://api.example/api/videos/180d892c-cf14-4318-974d-2eee0e0ed022'));
				return stepSummary()!;
			});
			assert.match(s.steps, /^fetch:api\.example\/api\/videos\/:id 2x/);
			assert.doesNotMatch(s.steps, /SECRET|9a66/);
		} finally {
			globalThis.fetch = real;
		}
	});

	it('names at most six kinds and keeps at most forty', async () => {
		const s = await runWithSteps(async () => {
			for (let i = 0; i < 60; i++) timeStep(`k${i}`, () => i);
			return stepSummary()!;
		});
		assert.equal(s.steps.split(', ').length, 6);
	});

	it('outside a request nothing is timed', async () => {
		assert.equal(stepSummary(), undefined);
		assert.equal(timeStep('x', () => 5), 5);
		const t = timedBindings(bindings()) as any;
		assert.equal(await t.KV.get('x'), 'v');
	});
});
