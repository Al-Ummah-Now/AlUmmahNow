// Per-rung progress and the upload plan (pure; unit-tested in apps/media/test/rungs.test.ts).
//
// One FFmpeg pass encodes every rung together, so while it runs each rung is
// 'encoding' with the shared %. Then the rungs upload one at a time, lowest
// first: 'uploading' with the rung's own byte %, then 'done'. A failure marks
// every unfinished rung 'failed'.

/** The container reports at least this often while something moves, and at once on a state change. */
export const RUNG_EMIT_MS = 15_000;

const short = (r) => Math.min(r.width, r.height);

/** Rungs lowest first (by the short side, so Shorts order the same as landscape). */
export function ascending(rungs) {
	return [...rungs].sort((a, b) => short(a) - short(b));
}

export class RungTracker {
	/** @param {{ name: string }[]} rungs */
	constructor(rungs) {
		/** @type {{ name: string, state: string, progress?: number }[]} */
		this.states = rungs.map((r) => ({ name: r.name, state: 'pending' }));
		this.lastEmitAt = 0;
		this.dirty = false;
	}

	/** Every unfinished rung → state (optionally with a shared progress). */
	setAll(state, progress) {
		for (const r of this.states) if (r.state !== 'done') this.#set(r, state, progress);
	}

	set(name, state, progress) {
		const r = this.states.find((x) => x.name === name);
		if (r) this.#set(r, state, progress);
	}

	#set(r, state, progress) {
		if (r.state !== state) this.dirty = true;
		r.state = state;
		if ((state === 'encoding' || state === 'uploading') && typeof progress === 'number') r.progress = Math.min(1, Math.max(0, progress));
		else delete r.progress;
	}

	/** Mark what was not finished as failed. */
	fail() {
		this.setAll('failed');
	}

	/** Copy for an event. */
	snapshot() {
		return this.states.map((r) => ({ ...r }));
	}

	/** True (and resets the timer) when an event is due: a state changed, or RUNG_EMIT_MS passed. */
	due(now) {
		if (!this.dirty && now - this.lastEmitAt < RUNG_EMIT_MS) return false;
		this.dirty = false;
		this.lastEmitAt = now;
		return true;
	}
}

/**
 * The upload order, as groups uploaded one after the other:
 *   1. stills and anything outside a rung folder (no playlists),
 *   2. per rung, lowest first: its segments and init, then its playlist,
 *   3. the master playlist last.
 * A player can never fetch a playlist whose segments are not in R2 yet.
 * @param {string[]} files paths relative to the output folder ("720p/seg_00001.m4s", "thumb.jpg", "master.m3u8")
 * @param {{ name: string, width: number, height: number }[]} rungs
 * @returns {{ rung: string | null, files: string[], playlists?: string[] }[]}
 */
export function uploadPlan(files, rungs) {
	const isPlaylist = (f) => f.endsWith('.m3u8');
	const inRung = (f) => rungs.some((r) => f.startsWith(`${r.name}/`));
	/** @type {{ rung: string | null, files: string[], playlists?: string[] }[]} */
	const plan = [{ rung: null, files: files.filter((f) => !inRung(f) && !isPlaylist(f)) }];
	for (const r of ascending(rungs)) {
		const mine = files.filter((f) => f.startsWith(`${r.name}/`));
		plan.push({ rung: r.name, files: mine.filter((f) => !isPlaylist(f)), playlists: mine.filter(isPlaylist) });
	}
	// Any other playlist (none today), then the master
	plan.push({ rung: null, files: files.filter((f) => isPlaylist(f) && !inRung(f) && f !== 'master.m3u8') });
	plan.push({ rung: null, files: files.filter((f) => f === 'master.m3u8') });
	return plan;
}

/**
 * Upload by the plan. `put(file)` uploads one file and resolves to its byte count;
 * `size(file)` is its size on disk. Files inside a group go `concurrency` at a time,
 * the groups strictly one after the other. Reports each rung through the tracker
 * and calls `emit()` whenever the tracker says an event is due.
 */
export async function uploadByPlan({ plan, put, size, tracker, emit, concurrency = 6, now = () => Date.now() }) {
	let bytes = 0;
	const pool = async (files, onDone) => {
		const queue = [...files];
		await Promise.all(
			Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
				for (let f = queue.shift(); f; f = queue.shift()) {
					const n = await put(f);
					bytes += n;
					onDone?.(n);
				}
			}),
		);
	};
	for (const group of plan) {
		if (!group.rung) {
			await pool(group.files);
			continue;
		}
		const all = [...group.files, ...(group.playlists ?? [])];
		let total = 0;
		for (const f of all) total += await size(f);
		let sent = 0;
		tracker.set(group.rung, 'uploading', 0);
		if (tracker.due(now())) await emit();
		const progress = (n) => {
			sent += n;
			tracker.set(group.rung, 'uploading', total ? sent / total : 1);
			if (tracker.due(now())) void emit();
		};
		await pool(group.files, progress);
		await pool(group.playlists ?? [], progress);
		tracker.set(group.rung, 'done');
		if (tracker.due(now())) await emit();
	}
	return bytes;
}
