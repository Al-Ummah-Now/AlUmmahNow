// FFmpeg transcode server, one job per container (apps/media/src/transcoder.ts).
//
// The container has no internet. Everything goes through the Worker's outbound
// handlers:
//   GET  http://source.internal/src        the original upload (Range requests)
//   PUT  http://media.internal/<key>       one object into R2
//   POST http://control.internal/event     progress / ready / failed
//
// API (from the Worker): POST /jobs { jobId, prefix, attempt }, GET /status, GET /health.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { bandwidthOf, displaySize, ffmpegArgs, ladderFor, MP4_FILE, mp4Args, mp4Rung, progressSeconds, stillsArgs } from './ladder.mjs';
import { RungTracker, uploadByPlan, uploadPlan } from './rungs.mjs';

const PORT = 8080;
const WORK = '/tmp/work';
const CHUNK = 64 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 6;
/** Bunny file the current job's source came from (x-media-source from the Worker) */
let sourceFile;

/** @type {{ jobId: string, status: string, progress: number, error?: string, startedAt: number } | null} */
let current = null;
/** Where the current job is, for failure reports: fetch_source | probe | encode | stills | upload */
let stage = { name: 'start', detail: undefined };
let sourceBytesSoFar = 0;
/** Per-rung state of the current job (null before the probe) */
let tracker = null;
function setStage(name, detail) {
	stage = { name, detail };
}

const log = (msg, extra = {}) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), msg, jobId: current?.jobId, ...extra }) + '\n');

async function retrying(what, fn, tries = 5) {
	let last;
	for (let i = 0; i < tries; i++) {
		try {
			return await fn();
		} catch (error) {
			last = error;
			log(`${what} failed, retrying`, { attempt: i + 1, error: String(error?.message || error) });
			await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
		}
	}
	throw last;
}

async function event(body) {
	try {
		await retrying('event', async () => {
			const res = await fetch('http://control.internal/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (!res.ok && res.status >= 500) throw new Error(`event HTTP ${res.status}`);
		}, 3);
	} catch (error) {
		log('event lost', { error: String(error) });
	}
}

/** Download the source in 64 MiB ranges (each retried), so one dropped connection costs one chunk. */
async function download(dest) {
	const out = createWriteStream(dest);
	let offset = 0;
	let total = Infinity;
	try {
		while (offset < total) {
			const end = offset + CHUNK - 1;
			const buf = await retrying('source range', async () => {
				const res = await fetch('http://source.internal/src', { headers: { range: `bytes=${offset}-${end}` } });
				if (res.status === 404) {
					const why = (await res.text().catch(() => '')).trim();
					throw Object.assign(new Error(why || 'source_missing'), { fatal: why !== 'source_unavailable' });
				}
				if (res.status !== 206 && res.status !== 200) throw new Error(`source HTTP ${res.status}`);
				sourceFile = res.headers.get('x-media-source') || sourceFile;
				const range = res.headers.get('content-range');
				if (res.status === 206 && range) total = Number(range.split('/')[1]) || total;
				const ab = Buffer.from(await res.arrayBuffer());
				if (res.status === 200) total = ab.length; // server ignored Range: whole file
				return ab;
			});
			if (buf.length === 0) break;
			if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
			offset += buf.length;
			sourceBytesSoFar = offset;
		}
	} finally {
		await new Promise((r) => out.end(r));
	}
	if (offset === 0) throw Object.assign(new Error('source_empty'), { fatal: true });
	return offset;
}

function run(cmd, args, onLine) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let tail = '';
		p.stdout.on('data', (d) => {
			const s = d.toString();
			if (onLine) for (const line of s.split('\n')) onLine(line);
			else stdout += s;
		});
		p.stderr.on('data', (d) => {
			tail = (tail + d.toString()).slice(-4000);
		});
		p.on('error', reject);
		p.on('close', (code) =>
			code === 0
				? resolve(stdout)
				: reject(Object.assign(new Error(`${cmd} exited ${code}`), { stderrTail: tail.split('\n').filter((l) => l.trim()).slice(-20), exitCode: code })),
		);
	});
}

async function probe(file) {
	const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
	const v = (json.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
	if (!v) throw Object.assign(new Error('no_video_stream'), { fatal: true });
	const rotation = Number(v.tags?.rotate ?? (v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? 0);
	const [num, den] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
	const size = displaySize({ width: v.width, height: v.height, rotation });
	return {
		...size,
		codec: v.codec_name,
		fps: den ? num / den : 0,
		durationSeconds: Number(json.format?.duration) || Number(v.duration) || 0,
		hasAudio: (json.streams || []).some((s) => s.codec_type === 'audio'),
	};
}

async function walk(dir) {
	const out = [];
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...(await walk(p)));
		else out.push(p);
	}
	return out;
}

async function put(key, file) {
	const body = await readFile(file);
	await retrying(`put ${key}`, async () => {
		const res = await fetch(`http://media.internal/${key}`, { method: 'PUT', body, headers: { 'content-length': String(body.length) } });
		if (!res.ok) throw new Error(`put ${key} HTTP ${res.status}`);
	});
	return body.length;
}

async function runJob(job) {
	const t0 = Date.now();
	const src = join(WORK, 'source');
	const out = join(WORK, 'out');
	await rm(WORK, { recursive: true, force: true });
	await mkdir(out, { recursive: true });

	current.status = 'downloading';
	setStage('fetch_source');
	sourceFile = undefined;
	sourceBytesSoFar = 0;
	tracker = null;
	setStage('start');
	const sourceBytes = await download(src);
	const tDownload = Date.now();
	setStage('probe');
	const info = await probe(src);
	const rungs = ladderFor(info);
	log('probed', { info, rungs: rungs.map((r) => r.name) });
	await event({ type: 'started', jobId: job.jobId, rungs: rungs.map((r) => r.name), source: info });

	current.status = 'transcoding';
	setStage('encode', rungs.map((r) => r.name).join(','));
	for (const r of rungs) await mkdir(join(out, r.name), { recursive: true });
	// One pass encodes every rung: all 'encoding' with the shared %
	tracker = new RungTracker(rungs);
	const progressEvent = () => event({ type: 'progress', jobId: job.jobId, progress: current.progress, rungs: tracker.snapshot() });
	tracker.setAll('encoding', 0);
	if (tracker.due(Date.now())) await progressEvent();
	await run('ffmpeg', ffmpegArgs({ input: src, out, rungs, hasAudio: info.hasAudio, fps: info.fps }), (line) => {
		const s = progressSeconds(line);
		if (s === null || !(info.durationSeconds > 0)) return;
		current.progress = Math.min(0.99, s / info.durationSeconds);
		tracker.setAll('encoding', current.progress);
		if (tracker.due(Date.now())) progressEvent();
	});
	setStage('stills');
	const stills = stillsArgs({ input: src, out, durationSeconds: info.durationSeconds });
	await run('ffmpeg', stills.thumb);
	await run('ffmpeg', stills.thumbSmall);
	let preview;
	try {
		await run('ffmpeg', stills.preview);
		preview = 'preview.webp';
	} catch (error) {
		log('preview skipped', { error: String(error.message) }); // optional: never fails the job
	}
	// One progressive MP4 (D-SEO-11): a remux of the 480p rung, never a second encode. Optional: a
	// failure leaves the video without it and never fails the job
	let mp4;
	const mp4From = mp4Rung(rungs);
	if (mp4From) {
		try {
			await run('ffmpeg', mp4Args({ out, rung: mp4From.name }));
			mp4 = { file: MP4_FILE, rung: mp4From.name, width: mp4From.width, height: mp4From.height, bytes: (await stat(join(out, MP4_FILE))).size };
		} catch (error) {
			log('mp4 skipped', { error: String(error.message) });
			await rm(join(out, MP4_FILE), { force: true });
		}
	}
	await rm(src, { force: true });
	const tTranscode = Date.now();

	current.status = 'uploading';
	setStage('upload');
	const files = await walk(out);
	if (!files.some((f) => relative(out, f) === 'master.m3u8')) throw new Error('ffmpeg wrote no master playlist');
	// Encoded: every rung waits to upload, then goes up one at a time, lowest first.
	// Stills first, each rung's segments before its playlist, the master last (uploadPlan).
	tracker.setAll('pending');
	const bytes = await uploadByPlan({
		plan: uploadPlan(files.map((f) => relative(out, f)), rungs),
		put: (rel) => put(`${job.prefix}/${rel}`, join(out, rel)),
		size: async (rel) => (await stat(join(out, rel))).size,
		tracker,
		emit: progressEvent,
		concurrency: UPLOAD_CONCURRENCY,
	});

	const rungStats = [];
	for (const r of rungs) {
		const rf = files.filter((f) => relative(out, f).startsWith(`${r.name}/`));
		let rb = 0;
		for (const f of rf) rb += (await stat(f)).size;
		rungStats.push({ ...r, bytes: rb, segments: rf.filter((f) => f.endsWith('.m4s')).length, bandwidth: bandwidthOf(rb, info.durationSeconds) });
	}
	const tUpload = Date.now();
	const result = {
		rungs: rungStats.map((r) => ({ name: r.name, width: r.width, height: r.height, maxrate: r.maxrate, bandwidth: r.bandwidth, bytes: r.bytes, segments: r.segments })),
		objects: files.length,
		bytes: 0,
		durationSeconds: info.durationSeconds,
		source: { width: info.width, height: info.height, durationSeconds: info.durationSeconds, bytes: sourceBytes, codec: info.codec, hasAudio: info.hasAudio, ...(sourceFile ? { file: sourceFile } : {}) },
		timings: { downloadMs: tDownload - t0, transcodeMs: tTranscode - tDownload, uploadMs: tUpload - tTranscode, totalMs: tUpload - t0 },
		thumbnail: 'thumb.jpg',
		...(preview ? { preview } : {}),
		...(mp4 ? { mp4 } : {}),
	};
	result.bytes = bytes;
	await rm(WORK, { recursive: true, force: true });
	return result;
}

/** What /status and /jobs may answer: no error text. */
function publicState(c) {
	return { jobId: c.jobId, status: c.status, progress: c.progress, startedAt: c.startedAt, ...(c.result ? { result: c.result } : {}) };
}

const server = createServer(async (req, res) => {
	const send = (status, body) => {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	if (req.url === '/health') return send(200, { ok: true });
	// Status without the error text: the failure reason goes to the Worker in the 'failed' event only
	if (req.url === '/status') return send(200, current ? publicState(current) : { status: 'idle' });
	if (req.url === '/jobs' && req.method === 'POST') {
		let raw = '';
		for await (const c of req) raw += c;
		const job = JSON.parse(raw || '{}');
		if (!job.jobId || !/^(pub|priv)\/[A-Za-z0-9-]+\/[a-z0-9]+$/.test(job.prefix || '')) return send(400, { error: 'bad job' });
		if (current && current.jobId === job.jobId) return send(200, publicState(current));
		if (current && ['downloading', 'transcoding', 'uploading'].includes(current.status)) return send(409, { error: 'busy', current: publicState(current) });
		current = { jobId: job.jobId, status: 'starting', progress: 0, startedAt: Date.now() };
		send(202, publicState(current));
		runJob(job).then(
			async (result) => {
				current.status = 'ready';
				current.progress = 1;
				current.result = result; // the watchdog completes the job from /status if the event was lost
				log('ready', { totalMs: result.timings.totalMs, bytes: result.bytes });
				await event({ type: 'ready', jobId: job.jobId, result });
			},
			async (error) => {
				current.status = 'failed';
				current.error = String(error?.message || error);
				tracker?.fail();
				log('failed', { error: current.error });
				await event({
					type: 'failed',
					jobId: job.jobId,
					error: current.error,
					fatal: !!error?.fatal,
					...(tracker ? { rungs: tracker.snapshot() } : {}),
					failure: {
						stage: stage.name,
						...(stage.detail ? { stageDetail: stage.detail } : {}),
						elapsedMs: Date.now() - current.startedAt,
						source: { ...(sourceFile ? { file: sourceFile } : {}), bytes: sourceBytesSoFar },
						...(error?.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
						...(Array.isArray(error?.stderrTail) ? { stderrTail: error.stderrTail } : {}),
					},
				});
			},
		);
		return;
	}
	send(404, { error: 'not found' });
});

server.listen(PORT, () => log('listening', { port: PORT }));
