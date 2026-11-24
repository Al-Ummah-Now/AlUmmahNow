/**
 * Account events from Auth (AlUmmahNowAuth#507 C3a): the signed event, the switch, repeats, the queue, the order of
 * events on an account and the give-up and retry. Real SQL on the search migrations; Auth is a fixture key.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { forgetFeatureSwitches, lastAccountEventAt, writeFeatureSwitch } from '@al-ummah/shared-types';
import { accountEventsHandler, createAccountEventsInternalRouter } from '../src/endpoints/account-events/accountEvents';
import { handleAccountEventBatch, isAccountEventQueue, KEEP_MS, MAX_ATTEMPTS, runAccountEvent, sweepAccountEvents, type AccountActions, type AccountEventMessage } from '../src/lib/account-events/jobs';
import { forgetKeys } from '../src/lib/account-events/set';
import { ACCOUNT_EVENT_SQL, readReceived } from '../src/lib/account-events/store';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { applyFeatureGates } from '../src/middleware/require-feature';
import { SqliteD1 } from './search-sqlite-d1';

const ISSUER = 'https://auth.test.example';
const CLIENT = 'api-videos-machine';
const RISC = 'https://schemas.openid.net/secevent/risc/event-type/';
const VERIFY = 'https://schemas.openid.net/secevent/ssf/event-type/verification';
const PATH = '/webhooks/auth/account-events';

class JobsQueue {
	messages: AccountEventMessage[] = [];
	down = false;
	async send(m: AccountEventMessage) {
		if (this.down) throw new Error('queue down');
		this.messages.push(m);
	}
}

let realFetch: typeof fetch;
let keyServer: () => Response;
let sign: (payload: JWTPayload, header?: Record<string, unknown>) => Promise<string>;
let otherKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let db: SqliteD1;
let queue: JobsQueue;
let env: any;
let applied: string[];
let actions: AccountActions;

/** What Auth signs (AlUmmahNowAuth apps/auth/src/account-events/set.ts). */
const set = (over: Record<string, unknown> = {}, type = `${RISC}account-disabled`, detail: unknown = { reason: 'deleted' }): JWTPayload => ({
	iss: ISSUER,
	aud: CLIENT,
	iat: Math.floor(Date.now() / 1000),
	jti: crypto.randomUUID(),
	toe: Math.floor(Date.now() / 1000),
	seq: 1,
	sub_id: { format: 'iss_sub', iss: ISSUER, sub: 'usr_1' },
	events: { [type]: detail },
	...over,
});
const verification = (over: Record<string, unknown> = {}) => set({ sub_id: { format: 'opaque', id: CLIENT }, ...over }, VERIFY, {});

const app = () => {
	const a = new Hono();
	a.use('*', errorEnvelope);
	applyFeatureGates(a, 'api-videos');
	a.post(PATH, accountEventsHandler(actions) as never);
	a.route('/internal/account-events', createAccountEventsInternalRouter() as never);
	return a;
};
async function post(token: string, headers: Record<string, string> = { 'Content-Type': 'application/secevent+jwt' }) {
	const res = await app().request(PATH, { method: 'POST', headers, body: token }, env);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function receive(payload: JWTPayload): Promise<string> {
	assert.equal((await post(await sign(payload))).status, 202);
	return payload.jti!;
}
const status = async (jti: string) => (await readReceived(db as never, jti))?.status;
const turn = (on: boolean) => writeFeatureSwitch(env, { key: 'accountEvents', enabled: on, expectedVersion: on ? 0 : 1, actorId: 'usr_a', currentStored: !on });
/** Delivers one message as the queue would. */
async function deliver(body: unknown, attempts = 1) {
	const out: { acked: boolean; retried: { delaySeconds?: number } | null } = { acked: false, retried: null };
	await handleAccountEventBatch({ messages: [{ body, attempts, ack: () => void (out.acked = true), retry: (o = {}) => void (out.retried = o) }] }, env, undefined, actions);
	return out;
}

beforeEach(async () => {
	forgetKeys();
	forgetFeatureSwitches();
	const { publicKey, privateKey } = await generateKeyPair('ES256');
	otherKey = (await generateKeyPair('ES256')).privateKey;
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
	sign = (payload, header = {}) => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'secevent+jwt', ...header } as never).sign(privateKey);
	keyServer = () => Response.json({ keys: [jwk] });
	realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		return url === `${ISSUER}/.well-known/jwks.json` ? keyServer() : new Response('not found', { status: 404 });
	}) as typeof fetch;
	db = new SqliteD1();
	queue = new JobsQueue();
	env = { Issuer: ISSUER, ClientId: CLIENT, SEARCH_DB: db, ACCOUNT_EVENTS_QUEUE: queue };
	applied = [];
	const action = (name: string) => async (_: unknown, c: { userId: string; seq: number; reason: string | null }) => {
		applied.push(`${name} ${c.userId} ${c.seq}${c.reason ? ` ${c.reason}` : ''}`);
		return { complete: true };
	};
	actions = { 'account-disabled': action('hide'), 'account-enabled': action('restore'), 'account-purged': action('erase') };
	await turn(true);
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('the switch', () => {
	it('off: 404 feature_off, and nothing is read or kept', async () => {
		await turn(false);
		forgetFeatureSwitches();
		const r = await post(await sign(set()));
		assert.equal(r.status, 404);
		assert.equal(r.body.code, 'feature_off');
		assert.equal(db.count('account_events_received'), 0);
		assert.equal(await lastAccountEventAt(env), null);
	});
	it('starts off', async () => {
		env.SEARCH_DB = db = new SqliteD1();
		forgetFeatureSwitches();
		assert.equal((await post(await sign(set()))).status, 404);
	});
});

describe('receiving', () => {
	it('keeps the event, queues it once, and says when it arrived', async () => {
		const payload = set();
		const before = Date.now();
		assert.deepEqual(await post(await sign(payload)), { status: 202, body: null });
		assert.deepEqual(queue.messages, [{ kind: 'account-event', jti: payload.jti }]);
		const at = (await lastAccountEventAt(env))!;
		assert.ok(at >= before && at <= Date.now());
		// the same event again, signed again
		assert.equal((await post(await sign(payload))).status, 202);
		assert.equal(queue.messages.length, 1);
		assert.equal(db.count('account_events_received'), 1);
	});
	it('a verification only says that delivery works', async () => {
		const jti = await receive(verification());
		assert.equal(await status(jti), 'applied');
		assert.deepEqual(queue.messages, []);
		assert.ok(await lastAccountEventAt(env));
	});
	it('a queue that is down: 503, and the next try queues it', async () => {
		const payload = set();
		queue.down = true;
		assert.equal((await post(await sign(payload))).status, 503);
		queue.down = false;
		await receive(payload);
		assert.equal(queue.messages.length, 1);
	});
	it('an event Videos does nothing for yet is refused, so Auth keeps it', async () => {
		actions = {};
		const r = await post(await sign(set()));
		assert.equal(r.status, 400);
		assert.equal(r.body.err, 'invalid_request');
		assert.equal(db.count('account_events_received'), 0);
		await receive(verification());
	});
	it('keeps no email, name or age', async () => {
		await receive(set({ email: 'a@example.com', name: 'Amina', age: 12 }));
		assert.doesNotMatch(JSON.stringify(db.db.prepare('SELECT * FROM account_events_received').all()), /example|Amina|"age"/);
	});
});

describe('what is refused', () => {
	const cases: [string, () => Promise<string>, string][] = [
		['another signature', () => new SignJWT(set()).setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'secevent+jwt' }).sign(otherKey), 'invalid_key'],
		['another issuer', () => sign(set({ iss: 'https://evil.example' })), 'invalid_issuer'],
		['another audience', () => sign(set({ aud: 'videos-web' })), 'invalid_audience'],
		['two audiences', () => sign(set({ aud: [CLIENT, 'videos-web'] })), 'invalid_audience'],
		['no typ', () => sign(set(), { typ: undefined }), 'invalid_request'],
		['an access token', () => sign({ iss: ISSUER, aud: CLIENT, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900, sub: 'user:1', mode: 'access', type: 'user', properties: { id: 'usr_1' } }, { typ: 'JWT' }), 'invalid_request'],
		['an access token with our typ', () => sign({ iss: ISSUER, aud: CLIENT, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), sub: 'user:1', mode: 'access' }), 'invalid_request'],
		['an old token', () => sign(set({ iat: Math.floor(Date.now() / 1000) - 2 * 3600 })), 'invalid_request'],
		['no jti', () => sign(set({ jti: undefined })), 'invalid_request'],
		['a strange jti', () => sign(set({ jti: "x' OR 1" })), 'invalid_request'],
		['no seq', () => sign(set({ seq: undefined })), 'invalid_request'],
		['a fractional seq', () => sign(set({ seq: 1.5 })), 'invalid_request'],
		['an unknown event', () => sign(set({}, `${RISC}sessions-revoked`, {})), 'invalid_request'],
		['an inherited name', () => sign(set({}, 'toString', {})), 'invalid_request'],
		['two events', () => sign(set({ events: { [`${RISC}account-enabled`]: {}, [`${RISC}account-purged`]: {} } })), 'invalid_request'],
		['no event', () => sign(set({ events: {} })), 'invalid_request'],
		['another subject format', () => sign(set({ sub_id: { format: 'email', email: 'a@example.com' } })), 'invalid_request'],
		["another issuer's subject", () => sign(set({ sub_id: { format: 'iss_sub', iss: 'https://evil.example', sub: 'usr_1' } })), 'invalid_request'],
		['an empty subject', () => sign(set({ sub_id: { format: 'iss_sub', iss: ISSUER, sub: '' } })), 'invalid_request'],
		['an unknown reason', () => sign(set({}, `${RISC}account-disabled`, { reason: 'spam' })), 'invalid_request'],
		['no reason', () => sign(set({}, `${RISC}account-disabled`, {})), 'invalid_request'],
		["another client's verification", () => sign(verification({ sub_id: { format: 'opaque', id: 'other' } })), 'invalid_request'],
		['no token', async () => 'nonsense', 'invalid_request'],
		['an unsigned token', async () => `${btoa('{"alg":"none","typ":"secevent+jwt"}')}.${btoa(JSON.stringify(set()))}.`, 'invalid_request'],
	];
	for (const [name, token, code] of cases) {
		it(name, async () => {
			const r = await post(await token());
			assert.deepEqual([r.status, r.body.err], [400, code]);
			assert.equal(typeof r.body.description, 'string');
			assert.equal(db.count('account_events_received') + queue.messages.length, 0);
			assert.equal(await lastAccountEventAt(env), null);
		});
	}
	it('another content type, and a body that is too long', async () => {
		assert.equal((await post(await sign(set()), { 'Content-Type': 'application/json' })).status, 400);
		assert.equal((await post('x'.repeat(9000))).status, 400);
	});
	it('keys that cannot be read, and a key that is new here: try again', async () => {
		keyServer = () => new Response('down', { status: 500 });
		assert.equal((await post(await sign(set()))).status, 503);
		forgetKeys();
		keyServer = () => Response.json({ keys: [] });
		assert.equal((await post(await sign(set()))).status, 503);
		assert.equal(db.count('account_events_received'), 0);
	});
	it("keeps the keys, and looks again when Auth has a new one", async () => {
		let fetched = 0;
		const serve = keyServer;
		keyServer = () => (fetched++, serve());
		await receive(verification());
		await receive(verification());
		assert.equal(fetched, 1);
		// a key we have not seen: not looked up again at once (anyone could ask for that), then found
		const next = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(next.publicKey)), kid: 'k2', alg: 'ES256', use: 'sig' };
		const token = () => new SignJWT(verification()).setProtectedHeader({ alg: 'ES256', kid: 'k2', typ: 'secevent+jwt' }).sign(next.privateKey);
		keyServer = () => (fetched++, Response.json({ keys: [jwk] }));
		assert.equal((await post(await token())).status, 503);
		assert.equal(fetched, 1);
		const realNow = Date.now;
		Date.now = () => realNow() + 31_000;
		try {
			assert.equal((await post(await token())).status, 202);
		} finally {
			Date.now = realNow;
		}
		assert.equal(fetched, 2);
	});
	it('no client configured: try again', async () => {
		env.ClientId = undefined;
		assert.equal((await post(await sign(set()))).status, 503);
	});
});

describe('the order of events on an account', () => {
	it('each is applied once', async () => {
		const jti = await receive(set({ seq: 5 }));
		assert.equal(await runAccountEvent(env, jti, actions), 'applied');
		assert.equal(await runAccountEvent(env, jti, actions), 'skipped');
		assert.deepEqual(await deliver(queue.messages[0]), { acked: true, retried: null });
		assert.deepEqual(applied, ['hide usr_1 5 deleted']);
		// received again after it was applied
		await receive(set({ seq: 5, jti }));
		assert.equal(queue.messages.length, 1);
	});
	it('an older event is ignored, also when its hide is retried after the restore', async () => {
		const hide = await receive(set({ seq: 5 }));
		const failing = { ...actions, 'account-disabled': async () => { throw new Error('R2 down'); } };
		await assert.rejects(runAccountEvent(env, hide, failing), /R2 down/);
		const restore = await receive(set({ seq: 6 }, `${RISC}account-enabled`, {}));
		assert.equal(await runAccountEvent(env, restore, actions), 'applied');
		assert.equal(await runAccountEvent(env, hide, actions), 'ignored');
		assert.equal(await status(hide), 'ignored');
		assert.deepEqual(applied, ['restore usr_1 6']);
	});
	it('nothing follows a purge, and the purge itself goes on', async () => {
		const purge = await receive(set({ seq: 7 }, `${RISC}account-purged`, {}));
		let runs = 0;
		const slow: AccountActions = { ...actions, 'account-purged': async (_, c) => (runs++ ? { complete: true } : { complete: false, progress: `after ${c.progress}` }) };
		assert.equal(await runAccountEvent(env, purge, slow), 'more');
		const restore = await receive(set({ seq: 8 }, `${RISC}account-enabled`, {}));
		assert.equal(await runAccountEvent(env, restore, slow), 'ignored');
		assert.equal((await readReceived(db as never, purge))!.progress, 'after null');
		assert.equal(await runAccountEvent(env, purge, slow), 'applied');
		assert.deepEqual(applied, []);
	});
	it('one event works on an account at a time; another account does not wait', async () => {
		const hide = await receive(set({ seq: 5 }));
		const restore = await receive(set({ seq: 6 }, `${RISC}account-enabled`, {}));
		const other = await receive(set({ seq: 7, sub_id: { format: 'iss_sub', iss: ISSUER, sub: 'usr_2' } }));
		const nested: AccountActions = {
			...actions,
			'account-disabled': async (_, c) => {
				if (c.userId !== 'usr_1') return { complete: true };
				assert.equal(await runAccountEvent(env, restore, actions), 'busy');
				assert.equal(await runAccountEvent(env, hide, actions), 'busy');
				assert.equal(await runAccountEvent(env, other, nested), 'applied');
				assert.equal(await c.keep(), true);
				return { complete: true };
			},
		};
		assert.equal(await runAccountEvent(env, hide, nested), 'applied');
		queue.messages = [];
		assert.equal(await runAccountEvent(env, restore, actions), 'applied');
	});
	it('a worker that died leaves the account to the next one, and can no longer keep it', async () => {
		const hide = await receive(set({ seq: 5 }));
		let t = 1_000_000;
		const now = () => t;
		const stuck: AccountActions = {
			...actions,
			'account-disabled': async (_, c) => {
				t += 17 * 60_000;
				const restore = await receive(set({ seq: 6 }, `${RISC}account-enabled`, {}));
				assert.equal(await runAccountEvent(env, restore, actions, now), 'applied');
				assert.equal(await c.keep(), false);
				return { complete: false };
			},
		};
		assert.equal(await runAccountEvent(env, hide, stuck, now), 'more');
		assert.equal(await runAccountEvent(env, hide, actions, now), 'ignored');
		assert.deepEqual(applied, ['restore usr_1 6']);
	});
});

describe('the queue', () => {
	it('goes on in a new message, and waits its turn in one, without using up a retry', async () => {
		const jti = await receive(set());
		const first = queue.messages.shift();
		const working = actions['account-disabled']!;
		actions['account-disabled'] = async () => ({ complete: false, progress: 'p1' });
		assert.deepEqual(await deliver(first), { acked: true, retried: null });
		assert.deepEqual(queue.messages, [{ kind: 'account-event', jti }]);
		actions['account-disabled'] = async (e, c) => {
			assert.equal(c.progress, 'p1');
			assert.deepEqual(await deliver({ kind: 'account-event', jti }), { acked: true, retried: null });
			return working(e, c);
		};
		queue.messages = [];
		assert.deepEqual(await deliver({ kind: 'account-event', jti }), { acked: true, retried: null });
		assert.equal(queue.messages.length, 1); // the one that was busy
		assert.equal(await status(jti), 'applied');
	});
	it('retries with a backoff, then fails and can be retried from the Errors page', async () => {
		const jti = await receive(set());
		const working = actions['account-disabled']!;
		actions['account-disabled'] = async () => { throw new Error('R2 down'); };
		for (let n = 1; n < MAX_ATTEMPTS; n++) {
			const r = await deliver(queue.messages[0], n);
			assert.equal(r.acked, false);
			assert.equal(r.retried!.delaySeconds, Math.min(30 * 2 ** (n - 1), 900));
			assert.equal(await status(jti), 'received');
		}
		assert.deepEqual(await deliver(queue.messages[0], MAX_ATTEMPTS), { acked: true, retried: null });
		assert.equal(await status(jti), 'failed');
		const retry = (id: unknown) => app().request('/internal/account-events/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jti: id }) }, env);
		actions['account-disabled'] = working;
		assert.equal((await retry(jti)).status, 202);
		assert.equal((await retry(jti)).status, 404);
		for (const bad of [undefined, 5, crypto.randomUUID()]) assert.equal((await retry(bad)).status, 404);
		await deliver(queue.messages.at(-1));
		assert.equal(await status(jti), 'applied');
	});
	it('drops what it does not know', async () => {
		for (const body of [null, {}, { kind: 'other', jti: 'x' }, { kind: 'account-event' }]) assert.deepEqual(await deliver(body), { acked: true, retried: null });
		assert.ok(isAccountEventQueue('al-ummah-now-account-events-qa'));
		assert.ok(!isAccountEventQueue('al-ummah-now-admin-jobs'));
	});
	it('what was received is finished after the switch goes off', async () => {
		const jti = await receive(set());
		await turn(false);
		await deliver(queue.messages[0]);
		assert.equal(await status(jti), 'applied');
	});
});

describe('the sweep', () => {
	it('queues what was lost, once an hour, and removes old settled events', async () => {
		const now = Date.now();
		const lost = await receive(set({ seq: 1 }));
		const done = await receive(set({ seq: 2, sub_id: { format: 'iss_sub', iss: ISSUER, sub: 'usr_2' } }));
		await runAccountEvent(env, done, actions);
		queue.messages = [];
		assert.deepEqual(await sweepAccountEvents(env, now), { queued: 0, removed: 0 });
		assert.deepEqual(await sweepAccountEvents(env, now + 3_700_000), { queued: 1, removed: 0 });
		assert.deepEqual(queue.messages, [{ kind: 'account-event', jti: lost }]);
		await runAccountEvent(env, lost, { ...actions, 'account-disabled': async () => ({ complete: true }) });
		assert.deepEqual(await sweepAccountEvents(env, now + KEEP_MS + 60_000), { queued: 0, removed: 2 });
		// the account's newest seq stays: a late repeat is still ignored
		const late = await receive(set({ seq: 1 }));
		assert.equal(await runAccountEvent(env, late, actions), 'ignored');
	});
	it('keeps failed events, and an event whose first queueing failed is found', async () => {
		queue.down = true;
		const payload = set();
		await post(await sign(payload));
		queue.down = false;
		assert.equal((await sweepAccountEvents(env)).queued, 1);
		actions['account-disabled'] = async () => { throw new Error('x'); };
		await deliver(queue.messages[0], MAX_ATTEMPTS);
		assert.deepEqual(await sweepAccountEvents(env, Date.now() + 2 * KEEP_MS), { queued: 0, removed: 0 });
	});
});

it('no query scans a table', () => {
	for (const [name, sql] of Object.entries(ACCOUNT_EVENT_SQL)) {
		const params = [...new Set(sql.match(/\?\d/g) ?? [])].map(() => 1);
		for (const detail of db.plan({ sql, params })) assert.doesNotMatch(detail, /^SCAN (?!.*USING (COVERING )?INDEX)|TEMP B-TREE/, `${name}: ${detail}`);
	}
});
