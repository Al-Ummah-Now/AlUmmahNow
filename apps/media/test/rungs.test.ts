/**
 * Per-rung progress in the container (container/rungs.mjs): the state
 * transitions the admin chips show, the event throttle, and the upload order
 * (stills, then each rung lowest first with segments before its playlist,
 * the master last).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFor } from '../container/ladder.mjs';
import { ascending, RUNG_EMIT_MS, RungTracker, uploadByPlan, uploadPlan } from '../container/rungs.mjs';

type Rung = { name: string; state: string; progress?: number };
const LADDER = ladderFor({ width: 1920, height: 1080 });

describe('RungTracker', () => {
	it('starts pending, encodes all together with the shared %, then uploads and finishes one by one', () => {
		const t = new RungTracker(LADDER);
		assert.deepEqual(t.snapshot().map((r: Rung) => r.state), ['pending', 'pending', 'pending', 'pending']);
		t.setAll('encoding', 0.4);
		assert.deepEqual(t.snapshot(), LADDER.map((r: { name: string }) => ({ name: r.name, state: 'encoding', progress: 0.4 })));
		t.setAll('pending');
		t.set('360p', 'uploading', 0.5);
		assert.deepEqual(t.snapshot()[0], { name: '360p', state: 'uploading', progress: 0.5 });
		assert.equal(t.snapshot()[1].progress, undefined, 'pending carries no %');
		t.set('360p', 'done');
		assert.deepEqual(t.snapshot()[0], { name: '360p', state: 'done' });
	});

	it('a failure marks every unfinished rung failed and keeps the done ones', () => {
		const t = new RungTracker(LADDER);
		t.set('360p', 'done');
		t.set('480p', 'uploading', 0.2);
		t.fail();
		assert.deepEqual(t.snapshot().map((r: Rung) => r.state), ['done', 'failed', 'failed', 'failed']);
	});

	it('is due on every state change and otherwise every 15 s at most', () => {
		const t = new RungTracker(LADDER);
		t.setAll('encoding', 0);
		assert.equal(t.due(1000), true, 'pending → encoding');
		t.setAll('encoding', 0.1);
		assert.equal(t.due(2000), false, 'only the % moved');
		assert.equal(t.due(1000 + RUNG_EMIT_MS), true, '15 s later');
		t.set('360p', 'uploading', 0);
		assert.equal(t.due(1000 + RUNG_EMIT_MS + 1), true, 'state change at once');
	});
});

describe('upload order', () => {
	const files = [
		'master.m3u8', 'thumb.jpg', 'thumb_640.jpg', 'preview.webp',
		'1080p/index.m3u8', '1080p/init.mp4', '1080p/seg_00001.m4s',
		'360p/index.m3u8', '360p/init.mp4', '360p/seg_00001.m4s', '360p/seg_00002.m4s',
		'720p/init.mp4', '720p/seg_00001.m4s', '720p/index.m3u8',
		'480p/seg_00001.m4s', '480p/index.m3u8', '480p/init.mp4',
	];

	it('groups: stills, then rungs lowest first (segments, then playlist), master last', () => {
		const plan = uploadPlan(files, [...LADDER].reverse());
		assert.deepEqual(plan.map((g: { rung: string | null }) => g.rung), [null, '360p', '480p', '720p', '1080p', null, null]);
		assert.deepEqual(plan[0].files.sort(), ['preview.webp', 'thumb.jpg', 'thumb_640.jpg']);
		assert.deepEqual(plan[1].playlists, ['360p/index.m3u8']);
		assert.ok(plan[1].files.every((f: string) => !f.endsWith('.m3u8')));
		assert.deepEqual(plan.at(-1)?.files, ['master.m3u8']);
	});

	it('orders Shorts by the short side too', () => {
		const portrait = ladderFor({ width: 1080, height: 1920 });
		assert.deepEqual(ascending([...portrait].reverse()).map((r: { name: string }) => r.name), ['360p', '480p', '720p', '1080p']);
	});

	it('uploads one rung at a time, each rung done before the next starts, and reports each state change', async () => {
		const order: string[] = [];
		const events: Rung[][] = [];
		const tracker = new RungTracker(LADDER);
		tracker.setAll('encoding', 0.99);
		tracker.due(0);
		tracker.setAll('pending');
		let clock = 0;
		const bytes = await uploadByPlan({
			plan: uploadPlan(files, LADDER),
			put: async (f: string) => {
				await new Promise((r) => setTimeout(r, f.includes('seg_00001') ? 2 : 0));
				order.push(f);
				return 10;
			},
			size: async () => 10,
			tracker,
			emit: async () => {
				events.push(tracker.snapshot());
			},
			concurrency: 3,
			now: () => (clock += 1),
		});
		assert.equal(bytes, files.length * 10);
		const at = (f: string) => order.indexOf(f);
		assert.equal(order.at(-1), 'master.m3u8', 'master last');
		for (const still of ['thumb.jpg', 'thumb_640.jpg', 'preview.webp']) assert.ok(at(still) < at('360p/init.mp4'), 'stills first');
		const names = ['360p', '480p', '720p', '1080p'];
		names.forEach((n, i) => {
			const mine = order.filter((f) => f.startsWith(`${n}/`));
			assert.equal(mine.at(-1), `${n}/index.m3u8`, `${n}: segments before its playlist`);
			if (i > 0) assert.ok(at(`${names[i - 1]}/index.m3u8`) < Math.min(...mine.map(at)), `${names[i - 1]} finished before ${n} started`);
		});
		// Every state change reached an event: uploading then done, rung by rung
		const states = events.map((e) => e.map((r) => r.state).join(','));
		assert.ok(states.includes('uploading,pending,pending,pending'));
		assert.ok(states.includes('done,uploading,pending,pending'));
		assert.equal(states.at(-1), 'done,done,done,done');
		const uploading = events.flat().filter((r) => r.state === 'uploading');
		assert.ok(uploading.every((r) => typeof r.progress === 'number' && r.progress >= 0 && r.progress <= 1));
	});
});
