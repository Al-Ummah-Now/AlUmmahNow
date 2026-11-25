// FFmpeg transcode server, one job per container (apps/media/src/transcoder.ts).
//
// The container has no internet. Everything goes through the Worker's outbound
// handlers:
//   GET  http://source.internal/src        the original upload (Range requests)
//   PUT  http://media.internal/<key>       one object into R2
//   POST http://control.internal/event     progress / ready / failed
//   PUT  http://review.internal/<key>      review media (frames, audio, manifest) under review/<videoId>/<rev>/
//   GET  http://staging.internal/<rel>     renditions the creator pre-encoded in desktop Studio (D11; read only)
//   GET  http://audioin.internal/src       an uploaded audio track's file (audio-track jobs)
//   PUT  http://audioout.internal/<key>    the normalised track.m4a (audio-track jobs)
//   GET  http://trackin.internal/<trackId> a normalised track.m4a (package jobs)
//   GET|PUT http://pkg.internal/<key>      the demuxed package under <prefix>/a/ and its master_a<n>.m3u8
//
// API (from the Worker): POST /jobs { jobId, prefix, attempt }, GET /status, GET /health.
import { createServer } from 'node:http';
import { errorReason } from './errors.mjs';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { bandwidthOf, displaySize, ffmpegArgs, ladderFor, MP4_FILE, mp4Args, mp4Rung, playlistFiles, progressSeconds, stillsArgs, stillWithFallbacks } from './ladder.mjs';
import { SourceFacts, streamFacts } from './source-facts.mjs';
import { RungTracker, uploadByPlan, uploadPlan } from './rungs.mjs';
import { ENVELOPE_RATE, MATCH_FRAME_SIZE, avcCodec, contentMatches, envelope, frameDistance, masterPlaylist, matchTimes, mediaPlaylist, parseMediaPlaylist, stagedPathAllowed, verifyRenditions } from './prebuilt.mjs';
import { audioFailure, audioStreams, folderUploadOrder, masterVariants, normaliseArgs, packageMaster, splitRungArgs, TRACK_FILE, trackHlsArgs } from './audio.mjs';
import { audioArgs, captionAudioManifestFor, frameInterval, frameTimes, framesArgs, manifestFor, reviewVariant, thinFrames } from './review.mjs';

const PORT = 8080;
const WORK = '/tmp/work';
const CHUNK = 64 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 6;
/** Bunny file the current job's source came from (x-media-source from the Worker) */
let sourceFile;

/** @type {{ jobId: string, status: string, progress: number, error?: string, startedAt: number } | null} */
let current = null;
/** A live recording review, caption audio or audio track job is running (POST /review, /audio, /audio-*) */
let reviewing = false;
/** Where the current job is, for failure reports: fetch_source | probe | encode | stills | upload */
let stage = { name: 'start', detail: undefined };
let sourceBytesSoFar = 0;
/** What the current job's source is (source-facts.mjs); null until it is downloaded */
let sourceFacts = null;
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
async function download(dest, url = 'http://source.internal/src', reader = null) {
	const out = createWriteStream(dest);
	let offset = 0;
	let total = Infinity;
	try {
		while (offset < total) {
			const end = offset + CHUNK - 1;
			const buf = await retrying('source range', async () => {
				const res = await fetch(url, { headers: { range: `bytes=${offset}-${end}` } });
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
			reader?.update(buf);
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

/** One poster attempt may run this long */
const STILL_TIMEOUT_MS = 60_000;

function run(cmd, args, onLine, timeoutMs) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		// A process that outlives timeoutMs is killed and fails with its own error (timedOut), never as "no frame"
		let timedOut = false;
		const timer = timeoutMs ? setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs) : null;
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
		p.on('error', (e) => {
			if (timer) clearTimeout(timer);
			reject(e);
		});
		p.on('close', (code) => {
			if (timer) clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else if (timedOut) reject(Object.assign(new Error(`${cmd} timed out after ${timeoutMs} ms`), { timedOut: true }));
			else reject(Object.assign(new Error(`${cmd} exited ${code}`), { stderrTail: tail.split('\n').filter((l) => l.trim()).slice(-20), exitCode: code }));
		});
	});
}

/** A command's stdout as bytes (raw frames, PCM), killed after `timeoutMs`. */
function runBuffer(cmd, args, timeoutMs = 120_000) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		const chunks = [];
		const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
		p.stdout.on('data', (d) => chunks.push(d));
		p.on('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
		p.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(Buffer.concat(chunks));
			else reject(Object.assign(new Error(`${cmd} exited ${code}`), { exitCode: code }));
		});
	});
}

/** ffmpeg with every stderr line kept (showinfo prints frame times there). */
function runCollectingStderr(cmd, args) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		const lines = [];
		let partial = '';
		p.stderr.on('data', (d) => {
			const parts = (partial + d.toString()).split('\n');
			partial = parts.pop() ?? '';
			for (const l of parts) if (l.includes('showinfo')) lines.push(l);
		});
		p.on('error', reject);
		p.on('close', (code) => (code === 0 ? resolve(lines) : reject(Object.assign(new Error(`${cmd} exited ${code}`), { exitCode: code }))));
	});
}

/**
 * Pre-publication review (docs/specs/VIDEO-REVIEW.md §5): frames every `interval` seconds plus scene
 * cuts (near-duplicates dropped), and 16 kHz audio chunks, uploaded under the job's review prefix,
 * the manifest last. Never fails the transcode: returns { manifestKey } or { failed: true }.
 */
async function extractReview(job, src, info) {
	const dir = join(WORK, 'review');
	try {
		await rm(dir, { recursive: true, force: true });
		await mkdir(join(dir, 'frames'), { recursive: true });
		await mkdir(join(dir, 'audio'), { recursive: true });
		const { interval, capped } = frameInterval(info.durationSeconds, job.review);
		const times = frameTimes(await runCollectingStderr('ffmpeg', framesArgs({ input: src, out: join(dir, 'frames'), interval, sceneThreshold: job.review.sceneThreshold })));
		const files = (await readdir(join(dir, 'frames'))).filter((f) => f.endsWith('.jpg')).sort();
		const frames = thinFrames(files.map((file, i) => ({ file, atMs: times[i] ?? Math.round(i * interval * 1000) })), job.review.maxFrames);
		let audioCount = 0;
		if (info.hasAudio) {
			await run('ffmpeg', audioArgs({ input: src, out: join(dir, 'audio') }));
			audioCount = (await readdir(join(dir, 'audio'))).filter((f) => f.endsWith('.mp3')).length;
		}
		for (let i = 0; i < frames.length; i += UPLOAD_CONCURRENCY) {
			await Promise.all(frames.slice(i, i + UPLOAD_CONCURRENCY).map((f) => put(`${job.reviewPrefix}frames/${f.file}`, join(dir, 'frames', f.file), 'review.internal')));
		}
		for (let i = 0; i < audioCount; i++) {
			const name = `${String(i).padStart(3, '0')}.mp3`;
			await put(`${job.reviewPrefix}audio/${name}`, join(dir, 'audio', name), 'review.internal');
		}
		const manifest = manifestFor({ videoId: job.videoId, rev: job.rev, prefix: job.reviewPrefix, durationSeconds: info.durationSeconds, frames, audioCount, capped: capped || files.length > frames.length, now: new Date().toISOString() });
		await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
		await put(`${job.reviewPrefix}manifest.json`, join(dir, 'manifest.json'), 'review.internal');
		log('review media', { frames: frames.length, audio: audioCount, capped: manifest.capped });
		return { manifestKey: `${job.reviewPrefix}manifest.json` };
	} catch (error) {
		log('review media failed', { error: String(error?.message || error) });
		return { failed: true };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function probe(file) {
	const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
	if (sourceFacts) sourceFacts = { ...sourceFacts, ...streamFacts(json) };
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

/** Files above this go up as a stream (the progressive MP4 of a long video is hundreds of MB). */
const STREAM_ABOVE = 32 * 1024 * 1024;

async function put(key, file, host = 'media.internal') {
	const size = (await stat(file)).size;
	await retrying(`put ${key}`, async () => {
		const stream = size > STREAM_ABOVE;
		const body = stream ? Readable.toWeb(createReadStream(file)) : await readFile(file);
		const res = await fetch(`http://${host}/${key}`, { method: 'PUT', body, headers: { 'content-length': String(size) }, ...(stream ? { duplex: 'half' } : {}) });
		if (!res.ok) throw new Error(`put ${key} HTTP ${res.status}`);
	});
	return size;
}

/** GET one object of the ready rendition (rendition.internal, read only, this job's prefix) into a file. */
async function fetchRendition(rel, dest) {
	await retrying(`get ${rel}`, async () => {
		const res = await fetch(`http://rendition.internal/${rel}`);
		if (res.status === 404) throw Object.assign(new Error(`rendition_missing ${rel}`), { fatal: true });
		if (!res.ok) throw new Error(`get ${rel} HTTP ${res.status}`);
		await writeFile(dest, Buffer.from(await res.arrayBuffer()));
	});
}

/** GET one pre-encoded file (staging.internal, this job's staging prefix, read only). False when it is not there. */
async function fetchStaged(rel, dest) {
	return retrying(`staged ${rel}`, async () => {
		const res = await fetch(`http://staging.internal/${rel}`);
		if (res.status === 404) return false;
		if (!res.ok) throw new Error(`staged ${rel} HTTP ${res.status}`);
		await writeFile(dest, Buffer.from(await res.arrayBuffer()));
		return true;
	});
}

/** init + one segment as a playable file, for ffprobe and the decode check. */
async function joined(dir, init, seg) {
	const file = join(dir, `.check-${seg}.mp4`);
	await writeFile(file, Buffer.concat([await readFile(join(dir, init)), await readFile(join(dir, seg))]));
	return file;
}

async function probeRendition(dir, pl) {
	const file = await joined(dir, pl.init, pl.segments[0].file);
	try {
		const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file]));
		const v = (json.streams || []).find((x) => x.codec_type === 'video');
		const a = (json.streams || []).find((x) => x.codec_type === 'audio');
		const keys = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]))
			.split('\n')
			.map((l) => Number(l.trim().replace(/,$/, '')))
			.filter((n) => Number.isFinite(n));
		return {
			...(v ? { video: { codec: v.codec_name, width: v.width, height: v.height, pixFmt: v.pix_fmt, profile: v.profile, level: v.level, keyframeSeconds: keys } } : {}),
			...(a ? { audio: { codec: a.codec_name, channels: a.channels } } : {}),
		};
	} catch (error) {
		log('prebuilt probe failed', { error: String(error.message) });
		return null;
	} finally {
		await rm(file, { force: true });
	}
}

const FRAME_TIMEOUT_MS = 30_000;
const EXACT_FRAME_TIMEOUT_MS = 120_000;
/** Frames per rung that may be decoded from the start when a seek fails; more counts as a mismatch. */
const EXACT_FRAMES_PER_RUNG = 2;

/**
 * One frame at `t` seconds as a tiny grey thumbnail (MATCH_FRAME_SIZE), or null. Seeks on the input
 * first (fast); `exact` decodes from the start instead, for files whose index does not seek there.
 */
async function greyFrame(input, t, exact = false) {
	const { width, height } = MATCH_FRAME_SIZE;
	const seek = ['-ss', String(t)];
	try {
		const buf = await runBuffer('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...(exact ? [] : seek), '-i', input, ...(exact ? seek : []), '-frames:v', '1', '-vf', `scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], exact ? EXACT_FRAME_TIMEOUT_MS : FRAME_TIMEOUT_MS);
		return buf.length === width * height ? buf : null;
	} catch {
		return null;
	}
}

/** The loudness envelope of a file's first audio track. */
async function loudness(input) {
	// Decoding audio runs far faster than real time; a stuck decode is stopped
	return envelope(await runBuffer('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', input, '-map', 'a:0', '-ac', '1', '-ar', String(ENVELOPE_RATE), '-f', 's16le', 'pipe:1'], 15 * 60_000));
}

/**
 * Do the pre-encoded renditions show and sound like the source (prebuilt.mjs contentMatches)? Every
 * rung is compared at fresh random times; the source's frames are grabbed once per time.
 */
async function compareRungs(src, playlists, info) {
	const times = matchTimes(info.durationSeconds, undefined, () => randomInt(0, 1_000_000) / 1_000_000);
	const sourceFrames = [];
	for (const t of times) sourceFrames.push(await greyFrame(src, t));
	let sourceEnvelope = null;
	if (info.hasAudio) {
		try {
			sourceEnvelope = await loudness(src);
		} catch {
			return { ok: false, reason: 'audio_mismatch', rung: Object.keys(playlists)[0] };
		}
	}
	let sourceExact = 0;
	for (const [name, playlist] of Object.entries(playlists)) {
		const frameDistances = [];
		let exact = 0;
		for (let i = 0; i < times.length; i++) {
			let frame = await greyFrame(playlist, times[i]);
			let reference = sourceFrames[i];
			// Some files do not seek everywhere (e.g. some muxers' last segment): decode up to the instant
			// before calling it a mismatch, a couple of times per rung at most (a file that never seeks
			// is refused rather than decoded over and over)
			if (!frame && exact < EXACT_FRAMES_PER_RUNG) {
				exact++;
				frame = await greyFrame(playlist, times[i], true);
			}
			if (frame && !reference && sourceExact < EXACT_FRAMES_PER_RUNG) {
				sourceExact++;
				reference = sourceFrames[i] = await greyFrame(src, times[i], true);
			}
			frameDistances.push(frameDistance(reference, frame));
		}
		let renditionEnvelope = null;
		if (sourceEnvelope) {
			try {
				renditionEnvelope = await loudness(playlist);
			} catch {
				return { ok: false, reason: 'audio_mismatch', rung: name };
			}
		}
		const verdict = contentMatches({ frameDistances, sourceEnvelope, renditionEnvelope });
		if (!verdict.ok) return { ...verdict, rung: name };
	}
	return { ok: true };
}

/**
 * D11: use the renditions the creator encoded in desktop Studio when they match, exactly, what this
 * server would have encoded for this source (prebuilt.mjs). On a pass the rungs sit in `out` with
 * our own master playlist and the encode is skipped; anything else leaves `out` empty and says why,
 * and the normal encode runs. Never throws.
 */
async function usePrebuilt(job, src, info, rungs, out) {
	const names = rungs.map((r) => r.name);
	const cleanup = async () => {
		for (const n of new Set([...names, ...job.prebuilt.rungs])) await rm(join(out, n), { recursive: true, force: true }).catch(() => undefined);
		await rm(join(out, 'master.m3u8'), { force: true }).catch(() => undefined);
	};
	try {
		if (!Array.isArray(job.prebuilt.rungs) || job.prebuilt.rungs.some((n) => !names.includes(n))) return { used: false, reason: 'rungs_mismatch' };
		const checks = [];
		for (const name of job.prebuilt.rungs) {
			const dir = join(out, name);
			await mkdir(dir, { recursive: true });
			if (!(await fetchStaged(`${name}/index.m3u8`, join(dir, 'index.m3u8')))) {
				await cleanup();
				return { used: false, reason: 'file_missing', rung: name };
			}
			const playlist = parseMediaPlaylist(await readFile(join(dir, 'index.m3u8'), 'utf8'));
			const sizes = {};
			let probed = null;
			if (playlist.ok) {
				const files = [playlist.init, ...playlist.segments.map((x) => x.file)].filter((f) => stagedPathAllowed(`${name}/${f}`, names));
				for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
					await Promise.all(
						files.slice(i, i + UPLOAD_CONCURRENCY).map(async (f) => {
							if (await fetchStaged(`${name}/${f}`, join(dir, f))) sizes[f] = (await stat(join(dir, f))).size;
						}),
					);
				}
				if (sizes[playlist.init] && sizes[playlist.segments[0].file]) probed = await probeRendition(dir, playlist);
			}
			checks.push({ name, playlist, sizes, probe: probed });
		}
		const verdict = verifyRenditions({ ladder: rungs, source: info, rungs: checks });
		if (!verdict.ok) {
			await cleanup();
			return { used: false, reason: verdict.reason, ...(verdict.rung ? { rung: verdict.rung } : {}) };
		}
		// Our own media playlists replace the uploaded ones before anything reads them
		for (const c of checks) await writeFile(join(out, c.name, 'index.m3u8'), mediaPlaylist(c.playlist));
		// Every segment of every rung decodes end to end: any decoder error fails it
		for (const c of checks) {
			try {
				await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', join(out, c.name, 'index.m3u8'), '-f', 'null', '-']);
			} catch {
				await cleanup();
				return { used: false, reason: 'decode', rung: c.name };
			}
		}
		// Every rung shows and sounds like the source the server probed (review and stills then run
		// on the top rung, the one viewers get at full size)
		const match = await compareRungs(src, Object.fromEntries(checks.map((c) => [c.name, join(out, c.name, 'index.m3u8')])), info);
		if (!match.ok) {
			await cleanup();
			return { used: false, reason: match.reason, rung: match.rung };
		}
		const top = rungs[rungs.length - 1].name;
		const master = checks.map((c) => {
			const r = rungs.find((x) => x.name === c.name);
			const peak = Math.max(...c.playlist.segments.map((x) => (c.sizes[x.file] * 8) / x.seconds));
			const codecs = [avcCodec(c.probe.video.profile, c.probe.video.level), ...(c.probe.audio ? ['mp4a.40.2'] : [])].join(',');
			return { name: c.name, width: r.width, height: r.height, bandwidth: peak, codecs };
		});
		await writeFile(join(out, 'master.m3u8'), masterPlaylist(master));
		return { used: true, top: join(out, top, 'index.m3u8') };
	} catch (error) {
		await cleanup();
		return { used: false, reason: 'error', detail: String(error?.message || error).slice(0, 120) };
	}
}

/**
 * Remux-only job (the public MP4 backfill, #1182): the progressive MP4 of a rendition that is
 * already ready, from its own rung's init and segments in R2. Same rung choice and same stream
 * copy as a transcode (ladder.mjs), so no encode. Returns the result's `mp4`.
 */
async function runRemux(job) {
	const out = join(WORK, 'remux');
	await rm(WORK, { recursive: true, force: true });
	const rung = mp4Rung(job.rungs);
	if (!rung) throw Object.assign(new Error('no_rung'), { fatal: true });
	const dir = join(out, rung.name);
	await mkdir(dir, { recursive: true });
	await fetchRendition(`${rung.name}/index.m3u8`, join(dir, 'index.m3u8'));
	const files = playlistFiles(await readFile(join(dir, 'index.m3u8'), 'utf8'));
	if (!files) throw Object.assign(new Error('bad_playlist'), { fatal: true });
	for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
		await Promise.all(files.slice(i, i + UPLOAD_CONCURRENCY).map((f) => fetchRendition(`${rung.name}/${f}`, join(dir, f))));
	}
	await run('ffmpeg', mp4Args({ out, rung: rung.name }));
	const bytes = await put(`${job.prefix}/${MP4_FILE}`, join(out, MP4_FILE), 'mp4.internal');
	await rm(WORK, { recursive: true, force: true });
	return { file: MP4_FILE, rung: rung.name, width: rung.width, height: rung.height, bytes };
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
	sourceFacts = null;
	tracker = null;
	setStage('start');
	const reader = new SourceFacts();
	const sourceBytes = await download(src, undefined, reader);
	sourceFacts = reader.finish(sourceBytes);
	const tDownload = Date.now();
	setStage('probe');
	const info = await probe(src);
	const rungs = ladderFor(info);
	log('probed', { info, rungs: rungs.map((r) => r.name) });
	await event({ type: 'started', jobId: job.jobId, rungs: rungs.map((r) => r.name), source: info });

	tracker = new RungTracker(rungs);
	const progressEvent = () => event({ type: 'progress', jobId: job.jobId, progress: current.progress, rungs: tracker.snapshot() });
	// D11: the creator's own renditions, used only when they pass every check
	let prebuilt;
	if (job.prebuilt) {
		setStage('verify_prebuilt', job.prebuilt.rungs?.join(','));
		prebuilt = await usePrebuilt(job, src, info, rungs, out);
		log('prebuilt', prebuilt);
	}
	if (!prebuilt?.used) {
		current.status = 'transcoding';
		setStage('encode', rungs.map((r) => r.name).join(','));
		for (const r of rungs) await mkdir(join(out, r.name), { recursive: true });
		// One pass encodes every rung: all 'encoding' with the shared %
		tracker.setAll('encoding', 0);
		if (tracker.due(Date.now())) await progressEvent();
		await run('ffmpeg', ffmpegArgs({ input: src, out, rungs, hasAudio: info.hasAudio, fps: info.fps }), (line) => {
			const s = progressSeconds(line);
			if (s === null || !(info.durationSeconds > 0)) return;
			current.progress = Math.min(0.99, s / info.durationSeconds);
			tracker.setAll('encoding', current.progress);
			if (tracker.due(Date.now())) progressEvent();
		});
	}
	// Stills and review come from what viewers will get: the creator's top rung when it is used
	const published = prebuilt?.used ? prebuilt.top : src;
	setStage('stills');
	const stills = stillsArgs({ input: published, out, durationSeconds: info.durationSeconds });
	// Each attempt is bounded: a poster is a few seconds of decoding, so a minute means a stuck input
	const still = { run, log, timeoutMs: STILL_TIMEOUT_MS };
	await stillWithFallbacks(still, stills.thumb, stills.thumbFallbacks);
	await stillWithFallbacks(still, stills.thumbSmall, stills.thumbSmallFallbacks);
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
	// Review media from the published content (the source, or the creator's top rung), before the
	// source is deleted (only when the job asks for it)
	const review = job.review && job.reviewPrefix ? await extractReview(job, published, info) : undefined;
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
		...(review ? { review } : {}),
		...(prebuilt ? { prebuilt: { used: prebuilt.used, ...(prebuilt.reason ? { reason: prebuilt.reason } : {}), ...(prebuilt.rung ? { rung: prebuilt.rung } : {}) } } : {}),
	};
	result.bytes = bytes;
	await rm(WORK, { recursive: true, force: true });
	return result;
}

const SAFE_JOB = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_VIDEO = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_TRACK = /^(orig|t[a-z0-9]{6,24})$/;

async function readJson(req) {
	let raw = '';
	for await (const c of req) raw += c;
	try {
		return JSON.parse(raw || '{}');
	} catch {
		return {};
	}
}

/** One side job at a time, never beside a transcode. */
function busy() {
	return reviewing || (current && ['starting', 'downloading', 'transcoding', 'uploading'].includes(current.status));
}

/**
 * One audio track (MA5): the uploaded file (audioin.internal) or a stream of the video's own file
 * (source.internal), padded or cut to the video's length, AAC 128k stereo → track.m4a in the
 * originals bucket; with review on, 16 kHz chunks and a manifest (no frames) under reviewPrefix.
 */
async function runAudioTrack(job) {
	const t0 = Date.now();
	const dir = join(WORK, 'audio-track');
	await rm(dir, { recursive: true, force: true });
	await mkdir(join(dir, 'review'), { recursive: true });
	const src = join(dir, 'source');
	await download(src, job.input);
	const meta = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', src]));
	const streams = audioStreams(meta);
	const stream = job.input === 'http://audioin.internal/src' ? 0 : job.stream;
	if (!streams.some((s) => s.index === stream)) throw Object.assign(new Error(streams.length ? 'stream_missing' : 'no_audio'), { fatal: true });
	const file = join(dir, TRACK_FILE);
	await run('ffmpeg', normaliseArgs({ input: src, out: file, stream, durationSeconds: job.durationSeconds }));
	await rm(src, { force: true });
	await put(job.out, file, 'audioout.internal');
	let reviewManifestKey;
	if (job.reviewPrefix) {
		await run('ffmpeg', audioArgs({ input: file, out: join(dir, 'review') }));
		const files = (await readdir(join(dir, 'review'))).filter((f) => f.endsWith('.mp3')).sort();
		for (const name of files) await put(`${job.reviewPrefix}audio/${name}`, join(dir, 'review', name), 'review.internal');
		const manifest = manifestFor({ videoId: job.videoId, rev: `audio-${job.trackId}`, prefix: job.reviewPrefix, durationSeconds: job.durationSeconds, frames: [], audioCount: files.length, capped: false, now: new Date().toISOString() });
		await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
		await put(`${job.reviewPrefix}manifest.json`, join(dir, 'manifest.json'), 'review.internal');
		reviewManifestKey = `${job.reviewPrefix}manifest.json`;
	}
	log('audio track', { jobId: job.jobId, trackId: job.trackId, ms: Date.now() - t0 });
	return { durationSeconds: job.durationSeconds, ...(reviewManifestKey ? { reviewManifestKey } : {}) };
}

/** Whether a package folder is complete (its playlist goes up last). */
async function pkgHas(rel) {
	const res = await fetch(`http://pkg.internal/${rel}`, { method: 'GET', headers: { range: 'bytes=0-0' } });
	await res.arrayBuffer().catch(() => undefined);
	if (res.status === 404) return false;
	if (!res.ok) throw new Error(`pkg ${rel} HTTP ${res.status}`);
	return true;
}

async function putFolder(local, remote) {
	const order = folderUploadOrder(await readdir(local));
	const media = order.filter((f) => f !== 'index.m3u8');
	for (let i = 0; i < media.length; i += UPLOAD_CONCURRENCY) {
		await Promise.all(media.slice(i, i + UPLOAD_CONCURRENCY).map((f) => put(`${remote}/${f}`, join(local, f), 'pkg.internal')));
	}
	if (order.includes('index.m3u8')) await put(`${remote}/index.m3u8`, join(local, 'index.m3u8'), 'pkg.internal');
}

async function hasAudioStream(file) {
	const meta = JSON.parse(await run('ffprobe', ['-v', 'error', '-allowed_extensions', 'ALL', '-print_format', 'json', '-show_streams', file]));
	return (meta.streams || []).some((s) => s.codec_type === 'audio');
}

/**
 * The demuxed package (MA2/MA3) of the ready rendition at job.prefix: each rung split into a
 * video-only copy (once; reused by later builds), the original audio from the top rung, each
 * extra track from its track.m4a, then master_a<version>.m3u8 last. Stream copy only.
 * Returns { master, trackIds } (the original is left out when the video has no sound).
 */
async function runAudioPackage(job) {
	const dir = join(WORK, 'audio-package');
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await fetchRendition('master.m3u8', join(dir, 'master.m3u8'));
	const variants = masterVariants(await readFile(join(dir, 'master.m3u8'), 'utf8'));
	if (!variants.length) throw Object.assign(new Error('bad_master'), { fatal: true });
	const top = variants.reduce((a, b) => ((Number(b.attrs.BANDWIDTH) || 0) > (Number(a.attrs.BANDWIDTH) || 0) ? b : a));
	let origReady = await pkgHas('a/orig/index.m3u8');
	let origSilent = false;
	// The top rung first: it also gives the original audio
	for (const v of [top, ...variants.filter((x) => x !== top)]) {
		const wantAudio = v === top && !origReady;
		if (!wantAudio && (await pkgHas(`a/v/${v.rung}/index.m3u8`))) continue;
		const rungDir = join(dir, 'in', v.rung);
		await mkdir(rungDir, { recursive: true });
		await fetchRendition(`${v.rung}/index.m3u8`, join(rungDir, 'index.m3u8'));
		const files = playlistFiles(await readFile(join(rungDir, 'index.m3u8'), 'utf8'));
		if (!files) throw Object.assign(new Error('bad_playlist'), { fatal: true });
		for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
			await Promise.all(files.slice(i, i + UPLOAD_CONCURRENCY).map((f) => fetchRendition(`${v.rung}/${f}`, join(rungDir, f))));
		}
		const input = join(rungDir, 'index.m3u8');
		const audio = wantAudio && (await hasAudioStream(input));
		if (wantAudio && !audio) origSilent = true;
		const videoDir = join(dir, 'out', 'v', v.rung);
		const audioDir = join(dir, 'out', 'orig');
		await mkdir(videoDir, { recursive: true });
		if (audio) await mkdir(audioDir, { recursive: true });
		await run('ffmpeg', splitRungArgs({ input, videoDir, ...(audio ? { audioDir } : {}) }));
		await putFolder(videoDir, `${job.prefix}/a/v/${v.rung}`);
		if (audio) {
			await putFolder(audioDir, `${job.prefix}/a/orig`);
			origReady = true;
		}
		await rm(join(dir, 'in', v.rung), { recursive: true, force: true });
		await rm(join(dir, 'out'), { recursive: true, force: true });
	}
	for (const t of job.tracks) {
		if (t.id === 'orig' || (await pkgHas(`a/${t.id}/index.m3u8`))) continue;
		const src = join(dir, `${t.id}.m4a`);
		await retrying(`track ${t.id}`, async () => {
			const res = await fetch(`http://trackin.internal/${t.id}`);
			if (res.status === 404) throw Object.assign(new Error(`track_missing ${t.id}`), { fatal: true });
			if (!res.ok) throw new Error(`track ${t.id} HTTP ${res.status}`);
			await writeFile(src, Buffer.from(await res.arrayBuffer()));
		});
		const out = join(dir, 'out', t.id);
		await mkdir(out, { recursive: true });
		await run('ffmpeg', trackHlsArgs({ input: src, dir: out }));
		await putFolder(out, `${job.prefix}/a/${t.id}`);
		await rm(src, { force: true });
		await rm(out, { recursive: true, force: true });
	}
	const tracks = job.tracks.filter((t) => t.id !== 'orig' || (origReady && !origSilent));
	if (!tracks.length) throw Object.assign(new Error('no_tracks'), { fatal: true });
	const master = `master_a${job.version}.m3u8`;
	await writeFile(join(dir, master), packageMaster({ variants, tracks }));
	await put(`${job.prefix}/${master}`, join(dir, master), 'pkg.internal');
	return { master, trackIds: tracks.map((t) => t.id) };
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
					...(sourceFacts ? { sourceFacts } : {}),
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
	if (req.url === '/remux' && req.method === 'POST') {
		let raw = '';
		for await (const c of req) raw += c;
		const job = JSON.parse(raw || '{}');
		if (!job.jobId || !/^(pub|priv)\/[A-Za-z0-9-]+\/[a-z0-9]+$/.test(job.prefix || '') || !Array.isArray(job.rungs)) return send(400, { error: 'bad job' });
		if (current && ['starting', 'downloading', 'transcoding', 'uploading'].includes(current.status)) return send(409, { error: 'busy' });
		const t0 = Date.now();
		try {
			const mp4 = await runRemux(job);
			log('remuxed', { jobId: job.jobId, rung: mp4.rung, bytes: mp4.bytes, ms: Date.now() - t0 });
			return send(200, { mp4 });
		} catch (error) {
			log('remux failed', { jobId: job.jobId, error: String(error?.message || error) });
			await rm(WORK, { recursive: true, force: true }).catch(() => undefined);
			return send(500, { error: errorReason(error), fatal: !!error?.fatal, ...(Array.isArray(error?.stderrTail) ? { stderrTail: error.stderrTail } : {}) });
		}
	}
	// Live recording review (VR9): frames and audio from an HLS VOD read through vod.internal
	if (req.url === '/review' && req.method === 'POST') {
		let raw = '';
		for await (const c of req) raw += c;
		const job = JSON.parse(raw || '{}');
		if (!/^[A-Za-z0-9-]{8,64}$/.test(job.videoId || '') || !/^[a-z0-9]{8,32}$/.test(job.rev || '') || !/^http:\/\/vod\.internal\/[A-Za-z0-9._-]+\.m3u8$/.test(job.input || '') || job.reviewPrefix !== `review/${job.videoId}/${job.rev}/` || !job.review || typeof job.review !== 'object') {
			return send(400, { error: 'bad job' });
		}
		if (reviewing || (current && ['starting', 'downloading', 'transcoding', 'uploading'].includes(current.status))) return send(409, { error: 'busy' });
		reviewing = true;
		const t0 = Date.now();
		try {
			// One variant of a master playlist, so ffmpeg reads a single rendition
			const master = await fetch(job.input);
			if (!master.ok) throw Object.assign(new Error(`recording HTTP ${master.status}`), { fatal: master.status === 404 || master.status === 403 });
			const variant = reviewVariant(await master.text());
			const input = variant ? new URL(variant, job.input).toString() : job.input;
			const info = await probe(input);
			const out = await extractReview(job, input, info);
			if (!out.manifestKey) throw new Error('review media failed');
			log('live review media', { videoId: job.videoId, ms: Date.now() - t0 });
			return send(200, { manifestKey: out.manifestKey });
		} catch (error) {
			log('live review failed', { videoId: job.videoId, error: String(error?.message || error) });
			return send(500, { error: errorReason(error), fatal: !!error?.fatal });
		} finally {
			reviewing = false;
		}
	}
	// Captions (AUN-CAPTIONS §5.2): the audio only, read from source.internal, chunks under captions-work/<jobId>/
	if (req.url === '/audio' && req.method === 'POST') {
		let raw = '';
		for await (const c of req) raw += c;
		const job = JSON.parse(raw || '{}');
		if (!/^[A-Za-z0-9-]{8,64}$/.test(job.jobId || '') || !/^[A-Za-z0-9_-]{1,80}$/.test(job.videoId || '') || job.input !== 'http://source.internal/src' || job.prefix !== `captions-work/${job.jobId}/`) {
			return send(400, { error: 'bad job' });
		}
		if (reviewing || (current && ['starting', 'downloading', 'transcoding', 'uploading'].includes(current.status))) return send(409, { error: 'busy' });
		reviewing = true;
		const t0 = Date.now();
		const dir = join(WORK, 'captions');
		try {
			await rm(dir, { recursive: true, force: true });
			await mkdir(join(dir, 'audio'), { recursive: true });
			const meta = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', job.input]));
			if (!(meta.streams || []).some((s) => s.codec_type === 'audio')) return send(422, { error: 'no_audio', fatal: true });
			const durationSeconds = Number(meta.format?.duration) || 0;
			await run('ffmpeg', audioArgs({ input: job.input, out: join(dir, 'audio') }));
			const files = (await readdir(join(dir, 'audio'))).filter((f) => f.endsWith('.mp3')).sort();
			for (const name of files) await put(`${job.prefix}audio/${name}`, join(dir, 'audio', name), 'review.internal');
			const manifest = captionAudioManifestFor({ jobId: job.jobId, videoId: job.videoId, prefix: job.prefix, durationSeconds, audioCount: files.length, now: new Date().toISOString() });
			await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
			await put(`${job.prefix}manifest.json`, join(dir, 'manifest.json'), 'review.internal');
			log('caption audio', { jobId: job.jobId, chunks: files.length, ms: Date.now() - t0 });
			return send(200, { manifestKey: `${job.prefix}manifest.json` });
		} catch (error) {
			log('caption audio failed', { jobId: job.jobId, error: String(error?.message || error) });
			return send(500, { error: errorReason(error), fatal: !!error?.fatal });
		} finally {
			reviewing = false;
			await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
	// Audio tracks (AUN-MULTI-AUDIO): normalise one track, list the source's streams, write the package
	if (req.url === '/audio-track' && req.method === 'POST') {
		const job = await readJson(req);
		const sourceOk = job.input === 'http://audioin.internal/src' || (job.input === 'http://source.internal/src' && Number.isInteger(job.stream) && job.stream >= 0 && job.stream < 64);
		if (!SAFE_JOB.test(job.jobId || '') || !SAFE_VIDEO.test(job.videoId || '') || !SAFE_TRACK.test(job.trackId || '') || !sourceOk || job.out !== `audio/${job.videoId}/${job.trackId}/${TRACK_FILE}` || !(job.durationSeconds > 0) || (job.reviewPrefix !== undefined && !String(job.reviewPrefix).startsWith(`review/${job.videoId}/audio-${job.trackId}-`))) {
			return send(400, { error: 'bad job' });
		}
		if (busy()) return send(409, { error: 'busy' });
		reviewing = true;
		try {
			return send(200, await runAudioTrack(job));
		} catch (error) {
			log('audio track failed', { jobId: job.jobId, error: String(error?.message || error), stack: error?.stack });
			return send(500, audioFailure(error));
		} finally {
			reviewing = false;
			await rm(join(WORK, 'audio-track'), { recursive: true, force: true }).catch(() => undefined);
		}
	}
	if (req.url === '/audio-probe' && req.method === 'POST') {
		const job = await readJson(req);
		if (!SAFE_JOB.test(job.jobId || '') || !SAFE_VIDEO.test(job.videoId || '')) return send(400, { error: 'bad job' });
		try {
			const meta = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', 'http://source.internal/src']));
			return send(200, { streams: audioStreams(meta) });
		} catch (error) {
			log('audio probe failed', { jobId: job.jobId, error: String(error?.message || error), stack: error?.stack });
			return send(500, audioFailure(error));
		}
	}
	if (req.url === '/audio-package' && req.method === 'POST') {
		const job = await readJson(req);
		if (!SAFE_JOB.test(job.jobId || '') || !/^(pub|priv)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(job.prefix || '') || !Number.isInteger(job.version) || job.version < 1 || !Array.isArray(job.tracks) || !job.tracks.length || !job.tracks.every((t) => SAFE_TRACK.test(t?.id || ''))) {
			return send(400, { error: 'bad job' });
		}
		if (busy()) return send(409, { error: 'busy' });
		reviewing = true;
		const t0 = Date.now();
		try {
			const out = await runAudioPackage(job);
			log('audio package', { jobId: job.jobId, tracks: out.trackIds.length, ms: Date.now() - t0 });
			return send(200, out);
		} catch (error) {
			log('audio package failed', { jobId: job.jobId, error: String(error?.message || error), stack: error?.stack });
			return send(500, audioFailure(error));
		} finally {
			reviewing = false;
			await rm(join(WORK, 'audio-package'), { recursive: true, force: true }).catch(() => undefined);
		}
	}
	send(404, { error: 'not found' });
});

server.listen(PORT, () => log('listening', { port: PORT }));
