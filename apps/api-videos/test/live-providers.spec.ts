/**
 * Live providers (D3): assignment in every mode, admin settings and overrides
 * on real SQLite with the search migrations, the self-hosted edge's playlist
 * handling and VOD playlists, QoE beacons and the provider comparison.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_LIVE_ROUTING,
	assignLiveProvider,
	normaliseLiveRouting,
	percentile,
	weightedPick,
	type LiveAssignInput,
	type LiveProviderId,
	type LiveProviderUsage,
	type LiveRoutingSettings,
} from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import {
	estimateCost,
	forgetLiveRouting,
	insertSession,
	listChannelOverrides,
	nextAssignSeq,
	readChannelOverride,
	readLiveRouting,
	readSession,
	readUsage,
	removeChannelOverride,
	setChannelOverride,
	writeLiveRouting,
} from '../src/lib/live/store';
import { parseMediaPlaylist } from '../src/lib/live/edge';
import { vodMaster, vodMediaPlaylist } from '../src/lib/live/finalize';
import { compareProviders, parseBeacon, QoeRejected, recordBeacon } from '../src/lib/live/qoe';
import { selfHostedKey, verifySelfHostedKey, selfHostedFfmpeg } from '../src/lib/live/providers';

const usage = (over: Partial<Record<LiveProviderId, Partial<LiveProviderUsage>>> = {}): Record<LiveProviderId, LiveProviderUsage> => ({
	bunny: { active: 0, monthSpendUsd: 0, available: true, ...over.bunny },
	selfhosted: { active: 0, monthSpendUsd: 0, available: true, ...over.selfhosted },
});
const settings = (patch: Partial<LiveRoutingSettings> = {}): LiveRoutingSettings => normaliseLiveRouting({ ...DEFAULT_LIVE_ROUTING, ...patch });
const assign = (patch: Partial<LiveAssignInput> & { s?: Partial<LiveRoutingSettings> } = {}) =>
	assignLiveProvider({ settings: settings(patch.s), usage: patch.usage ?? usage(), seq: patch.seq ?? 0, channelOverride: patch.channelOverride, streamMove: patch.streamMove, now: '2026-11-11T00:00:00.000Z' });
const providerOf = (r: ReturnType<typeof assign>) => ('assignment' in r ? r.assignment.provider : null);
const reasonOf = (r: ReturnType<typeof assign>) => ('assignment' in r ? r.assignment.reason : null);

describe('assignment', () => {
	it('round-robin alternates strictly', () => {
		const picks = Array.from({ length: 10 }, (_, seq) => providerOf(assign({ seq })));
		assert.deepEqual(picks, ['selfhosted', 'bunny', 'selfhosted', 'bunny', 'selfhosted', 'bunny', 'selfhosted', 'bunny', 'selfhosted', 'bunny']);
		assert.equal(reasonOf(assign({ seq: 3 })), 'round_robin');
	});

	it('weighted split gives exactly the percentage over any 100 streams', () => {
		for (const pct of [0, 20, 50, 70, 80, 100]) {
			for (const offset of [0, 37, 1000]) {
				const bunny = Array.from({ length: 100 }, (_, i) => weightedPick(offset + i, pct)).filter((p) => p === 'bunny').length;
				assert.equal(bunny, pct, `pct ${pct} offset ${offset}`);
			}
		}
		const r = assign({ s: { mode: 'weighted', bunnyPercent: 70 }, seq: 5 });
		assert.equal(reasonOf(r), 'weighted');
		// 70/30 never puts more than one self-hosted stream in a row
		const seq = Array.from({ length: 30 }, (_, i) => weightedPick(i, 70)).join(',');
		assert.ok(!seq.includes('selfhosted,selfhosted'));
	});

	it('only modes pick that provider and reroute when it may not take streams', () => {
		assert.equal(providerOf(assign({ s: { mode: 'only_bunny' }, seq: 0 })), 'bunny');
		assert.equal(providerOf(assign({ s: { mode: 'only_selfhosted' }, seq: 1 })), 'selfhosted');
		const off = assign({ s: { mode: 'only_bunny', providers: { ...DEFAULT_LIVE_ROUTING.providers, bunny: { ...DEFAULT_LIVE_ROUTING.providers.bunny, enabled: false } } } });
		assert.equal(providerOf(off), 'selfhosted');
		assert.equal(reasonOf(off), 'rerouted_disabled');
	});

	it('a channel override beats the mode; a stream move beats the override', () => {
		assert.equal(providerOf(assign({ seq: 0, channelOverride: 'bunny' })), 'bunny');
		assert.equal(reasonOf(assign({ seq: 0, channelOverride: 'bunny' })), 'channel_override');
		const moved = assign({ seq: 0, channelOverride: 'bunny', streamMove: 'selfhosted' });
		assert.equal(providerOf(moved), 'selfhosted');
		assert.equal(reasonOf(moved), 'stream_move');
	});

	it('draining, concurrency, budget and unavailability reroute to the other provider', () => {
		const p = DEFAULT_LIVE_ROUTING.providers;
		const cases: Array<[Partial<LiveRoutingSettings>, Record<LiveProviderId, LiveProviderUsage>, string]> = [
			[{ providers: { ...p, bunny: { ...p.bunny, draining: true } } }, usage(), 'rerouted_draining'],
			[{ providers: { ...p, bunny: { ...p.bunny, maxConcurrent: 2 } } }, usage({ bunny: { active: 2 } }), 'rerouted_concurrency'],
			[{ providers: { ...p, bunny: { ...p.bunny, monthlyBudgetUsd: 50 } } }, usage({ bunny: { monthSpendUsd: 50 } }), 'rerouted_budget'],
			[{}, usage({ bunny: { available: false } }), 'rerouted_unavailable'],
		];
		for (const [s, u, reason] of cases) {
			const r = assign({ s, usage: u, seq: 1 }); // seq 1 = bunny's turn
			assert.equal(providerOf(r), 'selfhosted', reason);
			assert.equal(reasonOf(r), reason);
			assert.equal('assignment' in r && r.assignment.preferred, 'bunny');
		}
		// under the cap: no reroute
		assert.equal(providerOf(assign({ s: { providers: { ...p, bunny: { ...p.bunny, maxConcurrent: 2 } } }, usage: usage({ bunny: { active: 1 } }), seq: 1 })), 'bunny');
	});

	it('refuses with a clear code when neither provider may take the stream', () => {
		const p = DEFAULT_LIVE_ROUTING.providers;
		const budget = assign({
			s: { providers: { bunny: { ...p.bunny, monthlyBudgetUsd: 10 }, selfhosted: { ...p.selfhosted, monthlyBudgetUsd: 10 } } },
			usage: usage({ bunny: { monthSpendUsd: 11 }, selfhosted: { monthSpendUsd: 10 } }),
		});
		assert.equal('code' in budget && budget.code, 'live_budget');
		const capacity = assign({
			s: { providers: { bunny: { ...p.bunny, maxConcurrent: 1 }, selfhosted: { ...p.selfhosted, enabled: false } } },
			usage: usage({ bunny: { active: 1 } }),
		});
		assert.equal('code' in capacity && capacity.code, 'live_capacity');
		const off = assign({ s: { providers: { bunny: { ...p.bunny, enabled: false }, selfhosted: { ...p.selfhosted, draining: true } } } });
		assert.equal('code' in off && off.code, 'live_unavailable');
	});

	it('normalises admin input (clamps, drops unknown modes, keeps other fields)', () => {
		const s = normaliseLiveRouting({ mode: 'nope', bunnyPercent: 140, qoeSampleRate: 4, selfhosted: { idleTimeoutSec: 1 }, providers: { bunny: { maxConcurrent: -3, note: '  x  ' } } });
		assert.equal(s.mode, 'round_robin');
		assert.equal(s.bunnyPercent, 100);
		assert.equal(s.qoeSampleRate, 1);
		assert.equal(s.selfhosted.idleTimeoutSec, 15);
		assert.equal(s.providers.bunny.maxConcurrent, 0);
		assert.equal(s.providers.bunny.note, 'x');
		assert.equal(s.providers.selfhosted.enabled, true);
	});

	it('percentile is nearest-rank', () => {
		assert.equal(percentile([], 50), null);
		assert.equal(percentile([5, 1, 3], 50), 3);
		assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
	});
});

describe('settings, counter and overrides (D1)', () => {
	let db: D1Database;
	beforeEach(() => {
		db = new SqliteD1() as unknown as D1Database;
		forgetLiveRouting();
	});

	it('defaults until written; writes merge per provider and are cached 15 s', async () => {
		assert.equal((await readLiveRouting(db)).mode, 'round_robin');
		const { previous, current } = await writeLiveRouting(db, { mode: 'weighted', bunnyPercent: 80, providers: { bunny: { draining: true, note: 'maintenance' } } }, 'usr_admin');
		assert.equal(previous.mode, 'round_robin');
		assert.equal(current.mode, 'weighted');
		assert.equal(current.providers.bunny.draining, true);
		assert.equal(current.providers.bunny.enabled, true);
		assert.equal(current.providers.selfhosted.enabled, true);
		assert.equal(current.updatedBy, 'usr_admin');
		forgetLiveRouting();
		const read = await readLiveRouting(db, 1_000);
		assert.equal(read.bunnyPercent, 80);
		assert.equal(read.providers.bunny.note, 'maintenance');
		// within 15 s the isolate cache answers even if the row changes
		await (db as unknown as SqliteD1).db.prepare("UPDATE live_settings SET value = '{\"mode\":\"only_bunny\"}'").run();
		assert.equal((await readLiveRouting(db, 10_000)).mode, 'weighted');
		assert.equal((await readLiveRouting(db, 20_000)).mode, 'only_bunny');
	});

	it('the round-robin counter hands out consecutive numbers', async () => {
		const seqs = [await nextAssignSeq(db), await nextAssignSeq(db), await nextAssignSeq(db)];
		assert.deepEqual(seqs, [0, 1, 2]);
	});

	it('channel overrides set, list and remove', async () => {
		assert.equal(await readChannelOverride(db, 'ch-1'), null);
		await setChannelOverride(db, 'ch-1', 'bunny', 'test', 'usr_admin');
		const prev = await setChannelOverride(db, 'ch-1', 'selfhosted', null, 'usr_admin');
		assert.equal(prev.previous, 'bunny');
		assert.equal((await listChannelOverrides(db))[0].provider, 'selfhosted');
		assert.equal((await removeChannelOverride(db, 'ch-1')).previous, 'selfhosted');
		assert.equal(await readChannelOverride(db, 'ch-1'), null);
	});

	it('usage counts live sessions and estimates this month\'s spend', async () => {
		const now = Date.UTC(2026, 10, 11, 12);
		const base = { stream_id: 's', channel_id: null, provider_ref: null, reason: 'round_robin', preferred: null, seq: 0, failover_from: null, failover_error: null, low_latency: 0, is_test: 0, playback_url: null };
		await insertSession(db, { ...base, id: 'a', provider: 'selfhosted', created_at: now - 3_600_000 });
		await insertSession(db, { ...base, id: 'b', provider: 'bunny', created_at: now - 3_600_000 });
		await insertSession(db, { ...base, id: 'old', provider: 'bunny', created_at: Date.UTC(2026, 9, 1) });
		const raw = (db as unknown as SqliteD1).db;
		raw.prepare("UPDATE live_sessions SET status = 'live', first_segment_at = ?, edge_requests = 2000000, delivered_bytes = 0 WHERE id = 'a'").run(now - 3_600_000);
		raw.prepare("UPDATE live_sessions SET status = 'ended', first_segment_at = ?, ended_at = ?, delivered_bytes = 100000000000 WHERE id = 'b'").run(now - 3_600_000, now);
		raw.prepare("UPDATE live_sessions SET status = 'ended', first_segment_at = 1, ended_at = 2, delivered_bytes = 900000000000 WHERE id = 'old'").run();
		const s = DEFAULT_LIVE_ROUTING;
		const u = await readUsage(db, s, now);
		assert.equal(u.selfhosted.active, 1);
		assert.equal(u.bunny.active, 0);
		assert.ok(Math.abs(u.selfhosted.monthSpendUsd - 0.6) < 1e-9); // 2 M requests × $0.30
		assert.ok(Math.abs(u.bunny.monthSpendUsd - 0.5) < 1e-9); // 100 GB × $0.005, last month's excluded
		assert.equal(estimateCost(s, 'bunny', { streamMs: 0, deliveredBytes: 1e9, edgeRequests: 0, storedBytes: 0 }), 0.005);
	});
});

describe('self-hosted edge', () => {
	it('keys are per session and version and compare exactly', async () => {
		const env = { LIVE_INGEST_SECRET: 'test-secret' };
		const k1 = await selfHostedKey(env, 'sess-1', 1);
		assert.match(k1, /^1\.[A-Za-z0-9_-]{32}$/);
		assert.equal(await verifySelfHostedKey(env, 'sess-1', 1, k1), true);
		assert.equal(await verifySelfHostedKey(env, 'sess-1', 2, k1), false);
		assert.equal(await verifySelfHostedKey(env, 'sess-2', 1, k1), false);
		assert.equal(await verifySelfHostedKey(env, 'sess-1', 1, k1.slice(0, -1) + 'x'), false);
	});

	it('parses media playlists into numbered segments', () => {
		const pl = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:1762860000', '#EXT-X-MAP:URI="init.mp4"',
			'#EXT-X-PROGRAM-DATE-TIME:2026-11-11T10:00:00.000Z', '#EXTINF:2.000000,', 'seg_1762860000.m4s', '#EXTINF:2.000000,', 'seg_1762860001.m4s', '#EXTINF:1.966,', 'seg_1762860002.m4s'].join('\n');
		const { segments, targetDuration } = parseMediaPlaylist(pl);
		assert.equal(targetDuration, 2);
		assert.deepEqual(segments.map((s) => s.seq), [1762860000, 1762860001, 1762860002]);
		assert.equal(segments[2].duration, 1.966);
		assert.equal(segments[0].uri, 'seg_1762860000.m4s');
	});

	it('VOD playlists mark reconnects as discontinuities and end the list', () => {
		const vod = vodMediaPlaylist([{ seq: 10, uri: 'seg_10.m4s', duration: 2 }, { seq: 11, uri: 'seg_11.m4s', duration: 2 }, { seq: 50, uri: 'seg_50.m4s', duration: 1.5 }], 'init.mp4');
		assert.match(vod, /#EXT-X-PLAYLIST-TYPE:VOD/);
		assert.match(vod, /#EXT-X-MAP:URI="init.mp4"/);
		assert.equal(vod.split('#EXT-X-DISCONTINUITY').length - 1, 1);
		assert.ok(vod.indexOf('#EXT-X-DISCONTINUITY') > vod.indexOf('seg_11.m4s'));
		assert.match(vod, /#EXT-X-ENDLIST\n$/);
		assert.equal(vodMaster('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720/index.m3u8\n'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720/vod.m3u8\n');
	});

	it('the ffmpeg example pushes fMP4 HLS with epoch numbering, PDT and the low-latency variant', () => {
		const normal = selfHostedFfmpeg('https://live.example/ingest/s/k', false);
		assert.match(normal, /-hls_time 2 /);
		assert.match(normal, /program_date_time/);
		assert.match(normal, /-hls_start_number_source epoch/);
		assert.match(normal, /-method PUT/);
		assert.match(selfHostedFfmpeg('x', true), /-hls_time 1 /);
	});
});

describe('QoE and comparison', () => {
	it('rejects malformed beacons and clamps values', () => {
		assert.throws(() => parseBeacon({}), QoeRejected);
		assert.throws(() => parseBeacon({ streamId: 's', sessionId: 'x', viewerKey: 'v', provider: 'mux', kind: 'start' }), QoeRejected);
		const b = parseBeacon({ streamId: 's', sessionId: 'x', viewerKey: 'v', provider: 'bunny', kind: 'window', latencyMs: [1000, 'x', -5, 9e9], rebufferMs: 9e9, extra: 'dropped' });
		assert.deepEqual(b.latencyMs, [1000, 0, 600000]);
		assert.equal(b.rebufferMs, 600000);
		assert.equal((b as unknown as Record<string, unknown>).extra, undefined);
	});

	it('stores beacons only for a matching session and compares providers', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const raw = (db as unknown as SqliteD1).db;
		const now = Date.UTC(2026, 10, 11, 12);
		const base = { channel_id: null, provider_ref: null, reason: 'round_robin', preferred: null, seq: 0, failover_from: null, failover_error: null, low_latency: 0, is_test: 0, playback_url: null };
		await insertSession(db, { ...base, id: 'sh', stream_id: 'st1', provider: 'selfhosted', created_at: now - 7_200_000 });
		await insertSession(db, { ...base, id: 'bn', stream_id: 'st2', provider: 'bunny', created_at: now - 7_200_000, failover_from: 'selfhosted' });
		raw.prepare("UPDATE live_sessions SET status = 'ended', start_requested_at = ?, ingest_connected_at = ?, first_segment_at = ?, ended_at = ?, vod_ready_at = ?, edge_requests = 1000000, reconnects = 1 WHERE id = 'sh'")
			.run(now - 7_000_000, now - 6_999_000, now - 6_996_000, now - 3_396_000, now - 3_395_000);
		raw.prepare("UPDATE live_sessions SET status = 'live', first_segment_at = ? WHERE id = 'bn'").run(now - 3_600_000);
		raw.prepare("INSERT INTO live_events (id, session_id, provider, kind, at, value) VALUES ('e1', 'sh', 'selfhosted', 'reconnect', ?, 4200)").run(now - 5_000_000);
		const beacon = (sessionId: string, streamId: string, provider: LiveProviderId, latency: number[], extra: Record<string, unknown> = {}) =>
			parseBeacon({ sessionId, streamId, provider, viewerKey: 'v1', kind: 'window', latencyMs: latency, watchMs: 30_000, bitrateKbps: 2000, ...extra });
		await assert.rejects(recordBeacon(db, beacon('sh', 'wrong', 'selfhosted', [1]), {}, now), QoeRejected);
		await assert.rejects(recordBeacon(db, beacon('sh', 'st1', 'bunny', [1]), {}, now), QoeRejected);
		// ended over an hour ago: refused
		await assert.rejects(recordBeacon(db, beacon('sh', 'st1', 'selfhosted', [1]), {}, now + 400_000), QoeRejected);
		for (let i = 0; i < 10; i++) {
			await recordBeacon(db, beacon('sh', 'st1', 'selfhosted', [4000 + i * 100], { rebufferMs: i === 0 ? 3000 : 0, rebufferCount: i === 0 ? 1 : 0, startupMs: 900 }), {}, now - 3_500_000 - i);
			await recordBeacon(db, beacon('bn', 'st2', 'bunny', [9000 + i * 100], { startupMs: 1500 }), {}, now - i);
		}
		const cmp = await compareProviders(db, { ...DEFAULT_LIVE_ROUTING, qoeSampleRate: 0.5 }, now - 86_400_000, now + 1, { now });
		const sh = cmp.providers.find((p) => p.provider === 'selfhosted')!;
		const bn = cmp.providers.find((p) => p.provider === 'bunny')!;
		assert.equal(sh.sessions, 1);
		assert.equal(sh.latencyMsP50, 4400);
		assert.equal(bn.latencyMsP50, 9400);
		assert.equal(sh.startupMsP50, 900);
		assert.equal(sh.ingestConnectMsP50, 1000);
		assert.equal(sh.firstSegmentMsP50, 3000);
		assert.equal(sh.vodReadyMsP50, 1000);
		assert.equal(sh.reconnectRecoveryMsP50, 4200);
		assert.equal(bn.failovers, 1);
		assert.ok(Math.abs(sh.viewerHours - (300_000 / 3_600_000) / 0.5) < 1e-9);
		assert.ok(sh.rebufferRatio! > 0 && sh.rebufferRatio! < 0.02);
		assert.ok(Math.abs(sh.estCostUsd - 0.3) < 1e-9); // 1 M edge requests
		assert.ok(bn.units.deliveredGb > 0, 'Bunny delivery estimated from viewer time × bitrate');
		assert.equal(cmp.days.length, 2);
	});
});

describe('current bitrate', () => {
	it('self-hosted: the top rendition over the last 30 s; Bunny: the last poll', async () => {
		const { currentBitrateKbps } = await import('../src/lib/live/service');
		const db = new SqliteD1() as unknown as D1Database;
		const raw = (db as unknown as SqliteD1).db;
		const now = Date.UTC(2026, 10, 11, 12);
		const base = { stream_id: 's', channel_id: null, provider_ref: null, reason: 'round_robin', preferred: null, seq: 0, failover_from: null, failover_error: null, low_latency: 0, is_test: 0, playback_url: null };
		await insertSession(db, { ...base, id: 'sh', provider: 'selfhosted', created_at: now });
		await insertSession(db, { ...base, id: 'bn', provider: 'bunny', created_at: now });
		raw.prepare("UPDATE live_sessions SET status = 'live'").run();
		const seg = raw.prepare('INSERT INTO live_segments (session_id, rendition, seq, uri, duration, bytes, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
		for (let i = 0; i < 5; i++) {
			seg.run('sh', '720', i, `seg_${i}.m4s`, 2, 750_000, now - 10_000 + i * 2000); // 3000 kbps
			seg.run('sh', '360', i, `seg_${i}.m4s`, 2, 175_000, now - 10_000 + i * 2000); // 700 kbps
		}
		seg.run('sh', '720', 99, 'seg_99.m4s', 2, 9_000_000, now - 120_000); // too old
		raw.prepare("INSERT INTO live_events (id, session_id, provider, kind, at, value) VALUES ('b1', 'bn', 'bunny', 'bitrate', ?, 4480.4)").run(now - 5000);
		assert.equal(await currentBitrateKbps(db, (await readSession(db, 'sh'))!, now), 3000);
		assert.equal(await currentBitrateKbps(db, (await readSession(db, 'bn'))!, now), 4480);
		raw.prepare("UPDATE live_sessions SET status = 'ended' WHERE id = 'sh'").run();
		assert.equal(await currentBitrateKbps(db, (await readSession(db, 'sh'))!, now), null);
	});
});
