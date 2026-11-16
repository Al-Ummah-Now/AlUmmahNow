/**
 * Max concurrent R2 transcodes (videos admin → Delivery): the slot rules, the admin's setting as the
 * consumer reads it, and the consumer's gate (a job with no free slot waits without using a delivery).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scaleStep, TRANSCODE_LIMIT_DEFAULT_MAX, TRANSCODE_LIMIT_DEFAULT_MIN, TRANSCODE_LIMIT_KEY } from '@al-ummah/shared-types';
import { acquireSlot, clearTranscodeLimitCache, emptySlots, LEASE_MS, readTranscodeLimit, releaseSlot, renewSlot, SLOT_WAIT_SECONDS, WAITER_MS, type SlotState } from '../src/slot-state';
import { gateTranscode } from '../src/dispatch';

const T = Date.parse('2026-11-15T12:00:00Z');
const vid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const job = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const R = (min: number, max = min) => ({ min, max });

/** Fill `n` slots from scratch under a fixed limit. */
function filled(n: number, limit: number): SlotState {
	let s = emptySlots();
	for (let i = 1; i <= n; i++) s = acquireSlot(s, vid(i), job(i), R(limit), T).state;
	return s;
}

describe('slot rules', () => {
	it('grants up to the limit, then makes the next job wait', () => {
		const s = filled(2, 2);
		assert.equal(Object.keys(s.leases).length, 2);
		const { answer, state } = acquireSlot(s, vid(3), job(3), R(2), T);
		assert.deepEqual(answer, { granted: false, inUse: 2, allowed: 2, ahead: 0, waiting: 1 });
		assert.ok(state.waiters[vid(3)]);
	});

	it('a redelivery or a newer job of a video that holds a slot keeps it, even at the limit', () => {
		const s = filled(2, 2);
		const { answer, state } = acquireSlot(s, vid(1), job(99), R(2), T + 1000);
		assert.equal(answer.granted, true);
		assert.equal(answer.inUse, 2);
		assert.equal(state.leases[vid(1)]!.jobId, job(99));
	});

	it('the oldest waiting job gets the next free slot', () => {
		let s = filled(1, 1);
		s = acquireSlot(s, vid(2), job(2), R(1), T + 1000).state; // waits first
		s = acquireSlot(s, vid(3), job(3), R(1), T + 2000).state; // waits second
		s = releaseSlot(s, vid(1), job(1), T + 3000);
		// The younger one asks first after the slot is free: still waits, one ahead of it
		const young = acquireSlot(s, vid(3), job(3), R(1), T + 4000);
		assert.equal(young.answer.granted, false);
		assert.equal(young.answer.ahead, 1);
		assert.equal(acquireSlot(young.state, vid(2), job(2), R(1), T + 5000).answer.granted, true);
	});

	it('a waiting job that stopped asking loses its place', () => {
		let s = filled(1, 1);
		s = acquireSlot(s, vid(2), job(2), R(1), T).state;
		s = releaseSlot(s, vid(1), job(1), T + 1000);
		assert.equal(acquireSlot(s, vid(3), job(3), R(1), T + WAITER_MS + 1).answer.granted, true);
	});

	it('a lease nobody renews lapses, so a lost job never keeps a slot for good', () => {
		const s = filled(1, 1);
		assert.equal(acquireSlot(s, vid(2), job(2), R(1), T + LEASE_MS - 1).answer.granted, false);
		assert.equal(acquireSlot(s, vid(2), job(2), R(1), T + LEASE_MS + 1).answer.granted, true);
	});

	it('the watchdog renews it; a retry keeps it until after its time', () => {
		let s = filled(1, 1);
		s = renewSlot(s, vid(1), job(1), T + 9 * LEASE_MS, T + 60_000);
		assert.equal(acquireSlot(s, vid(2), job(2), R(1), T + 5 * LEASE_MS).answer.granted, false);
	});

	it('only the job that holds a slot gives it back', () => {
		const s = filled(1, 1);
		assert.ok(releaseSlot(s, vid(1), job(42), T).leases[vid(1)]);
		assert.equal(releaseSlot(s, vid(1), job(1), T).leases[vid(1)], undefined);
	});

	it('a lower limit lets running jobs finish and starts nothing new until under it', () => {
		const s = filled(4, 4);
		assert.equal(acquireSlot(s, vid(5), job(5), R(2), T).answer.granted, false);
		let t = releaseSlot(s, vid(1), job(1), T);
		t = releaseSlot(t, vid(2), job(2), T);
		assert.equal(acquireSlot(t, vid(5), job(5), R(2), T).answer.granted, false);
		t = releaseSlot(t, vid(3), job(3), T);
		assert.equal(acquireSlot(t, vid(5), job(5), R(2), T).answer.granted, true);
	});
});

describe('autoscaling decision (scaleStep: queue depth vs running vs min/max)', () => {
	const arm = (allowed: number, stepArmed = true) => ({ allowed, stepArmed });
	it('nothing waiting: min, whatever was open before', () => {
		assert.equal(scaleStep(arm(6), 0, R(2, 6)).allowed, 2);
		assert.equal(scaleStep(arm(1), 0, R(2, 6)).allowed, 2);
	});
	it('jobs waiting after a start or finish: one more slot, then no more until the next start or finish', () => {
		const one = scaleStep(arm(2), 5, R(2, 6));
		assert.deepEqual(one, { allowed: 3, stepArmed: false });
		assert.deepEqual(scaleStep(one, 5, R(2, 6)), { allowed: 3, stepArmed: false });
	});
	it('never past max, never past it when max is lowered', () => {
		assert.equal(scaleStep(arm(6), 3, R(2, 6)).allowed, 6);
		assert.equal(scaleStep(arm(6), 3, R(2, 4)).allowed, 4);
	});
	it('min = max (the default 4–4) is a fixed limit', () => {
		assert.equal(scaleStep(arm(4), 9, R(4, 4)).allowed, 4);
	});
});

describe('autoscaling through the slots (min 2, max 4)', () => {
	const range = R(2, 4);
	/** Start `n` jobs in a row; returns the state and who got a slot. */
	function ask(s: SlotState, ids: number[], at: number) {
		const got: number[] = [];
		for (const i of ids) {
			const r = acquireSlot(s, vid(i), job(i), range, at);
			s = r.state;
			if (r.answer.granted) got.push(i);
		}
		return { s, got };
	}

	it('runs min at once, then while jobs wait opens one slot per start or finish, up to max', () => {
		// Idle: two start (min), the third waits; that wait follows a start, so one slot opens for it
		let { s, got } = ask(emptySlots(), [1, 2, 3], T);
		assert.deepEqual(got, [1, 2, 3]);
		assert.equal(s.allowed, 3);
		// Its start re-arms one more step: the next waiting job gets the 4th (max)
		({ s, got } = ask(s, [4, 5], T + 1000));
		assert.deepEqual(got, [4]);
		assert.equal(s.allowed, 4);
		// At max: the 5th keeps waiting even after more asks
		({ s, got } = ask(s, [5, 6], T + 2000));
		assert.deepEqual(got, []);
		assert.equal(Object.keys(s.leases).length, 4);
	});

	it('does not open a slot above min when nothing has to wait', () => {
		let { s } = ask(emptySlots(), [1], T);
		s = releaseSlot(s, vid(1), job(1), T + 1);
		const r = acquireSlot(s, vid(2), job(2), range, T + 2);
		assert.equal(r.answer.granted, true);
		assert.equal(r.state.allowed, 2);
	});

	it('falls back to min once the queue drains; running jobs are never stopped', () => {
		let { s } = ask(emptySlots(), [1, 2, 3, 4, 5], T); // 4 running, 5 waits
		assert.equal(s.allowed, 4);
		// 5 is cancelled (stops asking) and nothing else waits: a finish falls back to min
		s = releaseSlot(s, vid(5), job(5), T + 1000);
		s = releaseSlot(s, vid(1), job(1), T + 2000);
		assert.equal(s.allowed, 2);
		assert.equal(Object.keys(s.leases).length, 3);
		// Over min with nothing waiting: a new job waits (the queue is not empty again, so one slot opens,
		// but 3 still run in 3 allowed); the next finish lets it start
		let r = acquireSlot(s, vid(6), job(6), range, T + 3000);
		assert.equal(r.answer.granted, false);
		assert.equal(r.state.allowed, 3);
		s = releaseSlot(r.state, vid(2), job(2), T + 4000);
		r = acquireSlot(s, vid(6), job(6), range, T + 5000);
		assert.equal(r.answer.granted, true);
		assert.equal(Object.keys(r.state.leases).length, 3);
	});

	it('with min = max = 4 (the default) it behaves exactly like a fixed limit of 4', () => {
		let s = emptySlots();
		const got: number[] = [];
		for (const i of [1, 2, 3, 4, 5, 6]) {
			const r = acquireSlot(s, vid(i), job(i), R(4, 4), T);
			s = r.state;
			if (r.answer.granted) got.push(i);
		}
		assert.deepEqual(got, [1, 2, 3, 4]);
		assert.equal(s.allowed, 4);
	});
});

function settingsBucket(doc: unknown, calls = { n: 0 }) {
	return {
		calls,
		get: async (key: string) => {
			calls.n++;
			assert.equal(key, TRANSCODE_LIMIT_KEY);
			return doc === undefined ? null : { json: async () => doc };
		},
	} as unknown as R2Bucket & { calls: { n: number } };
}

describe('the admin setting as the consumer reads it', () => {
	beforeEach(() => clearTranscodeLimitCache());
	const env = (doc: unknown, ceiling = '10') => ({ GLOBAL_SETTINGS: settingsBucket(doc), MEDIA_TRANSCODE_CEILING: ceiling });

	it('uses the default 4–4 when unset, capped by the ceiling', async () => {
		assert.deepEqual(await readTranscodeLimit(env(undefined), T), { min: TRANSCODE_LIMIT_DEFAULT_MIN, max: TRANSCODE_LIMIT_DEFAULT_MAX });
		clearTranscodeLimitCache();
		assert.deepEqual(await readTranscodeLimit(env(undefined, '2'), T), { min: 2, max: 2 });
	});

	it('uses the stored range, never above the ceiling', async () => {
		assert.deepEqual(await readTranscodeLimit(env({ min: 2, max: 7 }), T), { min: 2, max: 7 });
		clearTranscodeLimitCache();
		assert.deepEqual(await readTranscodeLimit(env({ min: 3, max: 7 }, '2'), T), { min: 2, max: 2 });
	});

	it('reads the first version\'s single limit as min = max', async () => {
		assert.deepEqual(await readTranscodeLimit(env({ limit: 6 }), T), { min: 6, max: 6 });
	});

	it('ignores a broken document and an unreadable bucket (the defaults apply)', async () => {
		assert.deepEqual(await readTranscodeLimit(env({ min: 5, max: 3 }), T), { min: 4, max: 4 });
		clearTranscodeLimitCache();
		const broken = { get: async () => { throw new Error('r2 down'); } } as unknown as R2Bucket;
		assert.deepEqual(await readTranscodeLimit({ GLOBAL_SETTINGS: broken, MEDIA_TRANSCODE_CEILING: '10' }, T), { min: 4, max: 4 });
	});

	it('reads the bucket at most every 30 s, so a change applies within a minute', async () => {
		const bucket = settingsBucket({ min: 3, max: 3 });
		const e = { GLOBAL_SETTINGS: bucket, MEDIA_TRANSCODE_CEILING: '10' };
		await readTranscodeLimit(e, T);
		await readTranscodeLimit(e, T + 29_000);
		assert.equal(bucket.calls.n, 1);
		await readTranscodeLimit(e, T + 31_000);
		assert.equal(bucket.calls.n, 2);
	});
});

describe('the consumer gate', () => {
	beforeEach(() => clearTranscodeLimitCache());
	const body = { kind: 'transcode' as const, videoId: vid(9), jobId: job(9), rev: '0123456789abcdef', access: 'pub' as const, queuedAt: new Date(T).toISOString(), reason: 'upload' as const };

	function harness(opts: { granted?: boolean; acquireThrows?: boolean; sendThrows?: boolean; range?: { min: number; max: number } } = {}) {
		const seen: string[] = [];
		const msg = {
			body,
			attempts: 1,
			ack: () => seen.push('ack'),
			retry: (o?: { delaySeconds?: number }) => seen.push(`retry:${o?.delaySeconds}`),
		} as unknown as Message<typeof body>;
		const stub = {
			acquire: async (videoId: string, jobId: string, range: { min: number; max: number }) => {
				seen.push(`acquire:${videoId === vid(9) && jobId === job(9) ? 'job' : 'other'}:${range.min}-${range.max}`);
				if (opts.acquireThrows) throw new Error('do down');
				return { granted: opts.granted ?? true, inUse: 2, allowed: range.min, ahead: 0, waiting: 0 };
			},
		};
		const env = {
			TRANSCODE_SLOTS: { idFromName: (n: string) => (seen.push(`slots:${n}`), n), get: () => stub },
			TRANSCODE_QUEUE: {
				send: async (b: unknown, o: { delaySeconds: number }) => {
					if (opts.sendThrows) throw new Error('queue down');
					seen.push(`send:${(b as typeof body).jobId === job(9)}:${o.delaySeconds}`);
				},
			},
			GLOBAL_SETTINGS: settingsBucket(opts.range),
			MEDIA_TRANSCODE_CEILING: '10',
		} as never;
		return { msg, env, seen };
	}

	it('starts the job when it gets a slot, asking with the admin range', async () => {
		const h = harness({ granted: true, range: { min: 2, max: 6 } });
		assert.equal(await gateTranscode(h.msg, h.env), true);
		assert.deepEqual(h.seen, ['slots:global', 'acquire:job:2-6']);
	});

	it('with no free slot: sends the same job again later and acks this delivery (no delivery used up)', async () => {
		const h = harness({ granted: false });
		assert.equal(await gateTranscode(h.msg, h.env), false);
		assert.deepEqual(h.seen.slice(-2), [`send:true:${SLOT_WAIT_SECONDS}`, 'ack']);
	});

	it('when it cannot send it again, the queue redelivers it instead (never lost)', async () => {
		const h = harness({ granted: false, sendThrows: true });
		assert.equal(await gateTranscode(h.msg, h.env), false);
		assert.equal(h.seen.at(-1), `retry:${SLOT_WAIT_SECONDS}`);
		assert.equal(h.seen.includes('ack'), false);
	});

	it('when the slots are unreachable, starts anyway under the container ceiling', async () => {
		const h = harness({ acquireThrows: true });
		assert.equal(await gateTranscode(h.msg, h.env), true);
		assert.equal(h.seen.includes('ack'), false);
	});
});

describe('wrangler: ceiling and slots wired in every environment', () => {
	const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
	const videos = (f: string) => readFileSync(join(__dirname, '..', '..', 'api-videos', f), 'utf8');
	it('production: max_instances 3746 (the account\'s 15,000 vCPU less stage and QA, in standard-4) = MEDIA_TRANSCODE_CEILING = api-videos', () => {
		const prod = read('wrangler.jsonc').split('"env": {')[0]!;
		assert.ok(/"max_instances": 3746,/.test(prod));
		assert.ok(/"MEDIA_TRANSCODE_CEILING": "3746"/.test(prod));
		assert.ok(/"MEDIA_TRANSCODE_CEILING": "3746"/.test(videos('wrangler.jsonc').split('"env": {')[0]!));
	});
	it('stage and QA: max_instances 2 = the ceiling everywhere', () => {
		const stage = read('wrangler.jsonc').split('"env": {')[1]!;
		assert.ok(/"max_instances": 2,/.test(stage));
		assert.ok(/"MEDIA_TRANSCODE_CEILING": "2"/.test(stage));
		assert.ok(/"MEDIA_TRANSCODE_CEILING": "2"/.test(videos('wrangler.jsonc').split('"env": {')[1]!));
		assert.ok(/"max_instances": 2,[\s\S]*"MEDIA_TRANSCODE_CEILING": "2"/.test(read('wrangler.qa.jsonc')));
		assert.ok(/"MEDIA_TRANSCODE_CEILING": "2"/.test(videos('wrangler.qa.jsonc')));
	});
	for (const file of ['wrangler.jsonc', 'wrangler.qa.jsonc']) {
		it(`${file}: every environment binds the slots, the settings bucket and its own queue as producer`, () => {
			const text = read(file);
			const n = (re: RegExp) => (text.match(re) ?? []).length;
			const envs = n(/"class_name": "Transcoder",\s*"image"/g);
			assert.equal(n(/"name": "TRANSCODE_SLOTS", "class_name": "TranscodeSlots"/g), envs);
			assert.equal(n(/"tag": "v2", "new_sqlite_classes": \["TranscodeSlots"\]/g), envs);
			assert.equal(n(/"binding": "GLOBAL_SETTINGS", "bucket_name": "global-settings[^"]*"/g), envs);
			const producers = [...text.matchAll(/"binding": "TRANSCODE_QUEUE", "queue": "([^"]+)"/g)].map((m) => m[1]);
			const consumers = [...text.matchAll(/"queue": "(al-ummah-now-transcode[^"]*)",\s*"max_batch_size"/g)].map((m) => m[1]);
			assert.deepEqual(producers, consumers);
		});
	}
});
