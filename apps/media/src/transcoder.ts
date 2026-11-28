/**
 * One FFmpeg container per video (Durable Object named by the video id), so a
 * redelivered or retried queue message reaches the instance that already has
 * the job. The container has no internet: it reads the source, writes R2 and
 * reports progress only through the outbound handlers below, each bound at job
 * start to this job's video, prefix and id.
 */
import { Container, type OutboundHandlerContext } from '@cloudflare/containers';
import { audioTrackFileKey, failRungs, MEDIA_MP4, mediaPrefix, sanitizeDetectedStreams, sanitizeFailure, sanitizeMp4, sanitizeSourceFacts, type AudioPackageJobMessage, type AudioProbeJobMessage, type AudioTrackJobMessage, type CaptionAudioJobMessage, type LiveReviewJobMessage, type Mp4JobMessage, sanitizeRungs, type R2RungProgress, type TranscodeFailure, type TranscodeJobEvent, type TranscodeJobMessage, type TranscodeResult, type TranscodeSourceFacts } from '@al-ummah/shared-types';
import type { TranscodeStartFailure, TranscoderJobView } from '@al-ummah/shared-types';
import { bucketFor, errorText, log, type Env } from './env';
import { startupTimes, cancelledJob, containerSeconds, hasWatchdogDue, jobView, startFailureNote, isInfraFailure, keyAllowed, selfTestDue, selfTestRuns, startFailureReason, type SelfTestResult, liveReviewPrefix, liveVodSource, liveVodTarget, newJob, onFailure, onMessage, onProgressEvent, stagedKey, watchdogVerdict, WATCHDOG_SECONDS, type JobState } from './jobs';
import { reportAudioPackage, reportAudioProbe, reportAudioTrack, reportCaptionAudio, reportEvent, reportLiveReviewMedia, reportMp4Event, sourceCandidates } from './videos-api';
import { serveOriginal } from './originals';
import { storeUpload } from './uploads';
import { packageKeyAllowed, serveAudioUpload } from './audio';
import { LEASE_MS, slotsOf } from './slot-state';

/** Source URL that answered, per video (isolate memory; a miss just re-probes). */
const chosenSource = new Map<string, string>();

type ContainerEvent =
	| { type: 'started'; jobId: string }
	| { type: 'progress'; jobId: string; progress: number; rungs?: R2RungProgress[] }
	| { type: 'ready'; jobId: string; result: TranscodeResult }
	| { type: 'failed'; jobId: string; error: string; fatal?: boolean; failure?: Partial<TranscodeFailure>; rungs?: R2RungProgress[]; sourceFacts?: unknown };

/** What finishFailed adds to the container's own report (attempt, timing, instance). */
type FailureParts = Partial<TranscodeFailure>;

/** What a remux-only job did (the queue consumer acks, retries or gives up on it). */
export type Mp4Outcome = { outcome: 'ready' | 'busy' } | { outcome: 'failed'; error: string; fatal: boolean };

/** Delete every object under a prefix (a failed attempt's leftovers). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		if (page.objects.length) {
			await bucket.delete(page.objects.map((o) => o.key));
			deleted += page.objects.length;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return deleted;
}

export class Transcoder extends Container<Env> {
	override defaultPort = 8080;
	// The watchdog's /status call every minute keeps a working container awake
	override sleepAfter = '5m';
	override enableInternet = false;

	// Registered after the class (see the end of this file): a static class field would shadow
	// Container's static setter (ES2022 define semantics) and the handlers would never register.
	static readonly handlers = {
		/**
		 * GET http://source.internal/src (Range passed through) → the first source that
		 * answers: Bunny's original, else its highest MP4 fallback (remembered per job).
		 */
		async source(req: Request, env: Env, ctx: OutboundHandlerContext<{ videoId: string }>): Promise<Response> {
			if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
			// Our own kept original first (docs/media-delivery/ORIGINALS.md): no wait for Bunny, full quality
			const own = await serveOriginal(env, ctx.params.videoId, req.headers.get('range')).catch((error) => {
				log.warn('[Transcoder] Kept original unreadable; using Bunny', { videoId: ctx.params.videoId, error: errorText(error) });
				return null;
			});
			if (own) return own;
			const urls = await sourceCandidates(env, ctx.params.videoId);
			if (!urls.length) return new Response('source_missing', { status: 404 });
			const headers = new Headers();
			const range = req.headers.get('range');
			if (range) headers.set('range', range);
			const known = chosenSource.get(ctx.params.videoId);
			const order = known ? [known, ...urls.filter((u) => u !== known)] : urls;
			const refused: string[] = [];
			for (const url of order) {
				const res = await fetch(url, { method: req.method, headers });
				if (res.status === 404 || res.status === 403) {
					refused.push(`${new URL(url).pathname.split('/').pop()}:${res.status}`);
					continue;
				}
				const file = new URL(url).pathname.split('/').pop() ?? '';
				if (!known || known !== url) {
					chosenSource.set(ctx.params.videoId, url);
					log.warn('[Transcoder] Source chosen', { videoId: ctx.params.videoId, file, refused });
				}
				// The container records which Bunny file it transcoded (result.source.file)
				const out = new Response(res.body, res);
				out.headers.set('x-media-source', file);
				return out;
			}
			// Nothing yet: the original is refused by the CDN and Bunny has not made an MP4 yet. Retryable.
			log.warn('[Transcoder] No source answered', { videoId: ctx.params.videoId, refused });
			return new Response('source_unavailable', { status: 404 });
		},
		/** PUT http://media.internal/<key> → R2, only under this job's prefix */
		async media(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			if (!keyAllowed(ctx.params.prefix, key)) return new Response('key outside the job', { status: 403 });
			await storeUpload(bucketFor(env, key), key, req);
			return new Response(null, { status: 201 });
		},
		/** PUT http://review.internal/<key> → MEDIA_PRIVATE, only under this job's review/<videoId>/<rev>/ prefix */
		async review(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			if (!ctx.params.prefix || !key.startsWith(ctx.params.prefix) || key.includes('..')) return new Response('key outside the job', { status: 403 });
			await storeUpload(env.MEDIA_PRIVATE, key, req);
			return new Response(null, { status: 201 });
		},
		/** GET http://rendition.internal/<rel> → an object of this job's ready rendition (remux-only jobs; read only) */
		async rendition(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			if (req.method !== 'GET') return new Response('method', { status: 405 });
			const key = `${ctx.params.prefix}/${decodeURIComponent(new URL(req.url).pathname.slice(1))}`;
			if (!keyAllowed(ctx.params.prefix, key)) return new Response('key outside the job', { status: 403 });
			const obj = await bucketFor(env, key).get(key);
			if (!obj) return new Response('missing', { status: 404 });
			return new Response(obj.body, { headers: { 'content-length': String(obj.size) } });
		},
		/** GET http://staging.internal/<rung>/<file> → the creator's pre-encoded rendition files (D11; read only, this job's staging prefix) */
		async staging(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string; rungs: string }>): Promise<Response> {
			if (req.method !== 'GET') return new Response('method', { status: 405 });
			const key = stagedKey({ prefix: ctx.params.prefix, rungs: ctx.params.rungs.split(',') }, decodeURIComponent(new URL(req.url).pathname.slice(1)));
			if (!key) return new Response('key outside the job', { status: 403 });
			const obj = await env.MEDIA_PRIVATE.get(key);
			if (!obj) return new Response('missing', { status: 404 });
			return new Response(obj.body, { headers: { 'content-length': String(obj.size) } });
		},
		/** PUT http://mp4.internal/<prefix>/video.mp4 → R2: the one object a remux-only job may write */
		async mp4(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			if (key !== `${ctx.params.prefix}/${MEDIA_MP4}`) return new Response('key outside the job', { status: 403 });
			await storeUpload(bucketFor(env, key), key, req);
			return new Response(null, { status: 201 });
		},
		/**
		 * GET http://vod.internal/<rel> → a live recording's playlist or segment, read only and only
		 * under that recording's directory (live review jobs; the container has no internet)
		 */
		async vod(req: Request, _env: Env, ctx: OutboundHandlerContext<{ base: string }>): Promise<Response> {
			if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
			const url = new URL(req.url);
			const target = liveVodTarget(ctx.params.base, url.pathname.slice(1) + url.search);
			if (!target) return new Response('outside the recording', { status: 403 });
			const headers = new Headers();
			const range = req.headers.get('range');
			if (range) headers.set('range', range);
			const res = await fetch(target, { method: req.method, headers, redirect: 'error' });
			return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', ...(res.headers.get('content-length') ? { 'content-length': res.headers.get('content-length')! } : {}), ...(res.headers.get('content-range') ? { 'content-range': res.headers.get('content-range')! } : {}) } });
		},
		/** GET http://audioin.internal/src (Range) → an uploaded audio track's file, its chunks concatenated (audio-track jobs) */
		async audioin(req: Request, env: Env, ctx: OutboundHandlerContext<{ videoId: string; trackId: string; uploadId: string; bytes: number }>): Promise<Response> {
			if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
			if (new URL(req.url).pathname !== '/src') return new Response('not the upload', { status: 403 });
			return serveAudioUpload(env, ctx.params, req.headers.get('range'));
		},
		/** PUT http://audioout.internal/audio/<videoId>/<trackId>/track.m4a → MEDIA_ORIGINALS: the one object an audio-track job writes */
		async audioout(req: Request, env: Env, ctx: OutboundHandlerContext<{ key: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			if (key !== ctx.params.key || !env.MEDIA_ORIGINALS) return new Response('key outside the job', { status: 403 });
			await storeUpload(env.MEDIA_ORIGINALS, key, req);
			return new Response(null, { status: 201 });
		},
		/** GET http://trackin.internal/<trackId> → that track's normalised file, only the package's tracks (read only) */
		async trackin(req: Request, env: Env, ctx: OutboundHandlerContext<{ videoId: string; trackIds: string[] }>): Promise<Response> {
			if (req.method !== 'GET') return new Response('method', { status: 405 });
			const trackId = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (!ctx.params.trackIds.includes(trackId) || !env.MEDIA_ORIGINALS) return new Response('not a track of the job', { status: 403 });
			const obj = await env.MEDIA_ORIGINALS.get(audioTrackFileKey(ctx.params.videoId, trackId));
			if (!obj) return new Response('missing', { status: 404 });
			return new Response(obj.body, { headers: { 'content-length': String(obj.size), 'content-type': 'audio/mp4' } });
		},
		/** GET|PUT http://pkg.internal/<key> → the package under <prefix>/a/ and its master_a<n>.m3u8 (GET only tells whether an object exists) */
		async pkg(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (!packageKeyAllowed(ctx.params.prefix, key)) return new Response('key outside the job', { status: 403 });
			if (req.method === 'GET') {
				const head = await bucketFor(env, key).head(key);
				return head ? new Response('1', { status: 200 }) : new Response('missing', { status: 404 });
			}
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			await storeUpload(bucketFor(env, key), key, req);
			return new Response(null, { status: 201 });
		},
		/** POST http://control.internal/event → this job's Durable Object */
		async control(req: Request, env: Env, ctx: OutboundHandlerContext<{ videoId: string; jobId: string }>): Promise<Response> {
			if (req.method !== 'POST') return new Response('method', { status: 405 });
			const body = (await req.json()) as ContainerEvent;
			if (body.jobId !== ctx.params.jobId) return new Response('wrong job', { status: 409 });
			await env.TRANSCODER.get(env.TRANSCODER.idFromName(ctx.params.videoId)).onContainerEvent(body);
			return new Response(null, { status: 204 });
		},
	};

	private async job(): Promise<JobState | undefined> {
		return this.ctx.storage.get<JobState>('job');
	}

	private async save(job: JobState): Promise<void> {
		await this.ctx.storage.put('job', job);
	}

	/** Queue consumer entry. Idempotent per job id (a lost launch of the same job starts again). */
	async startJob(msg: TranscodeJobMessage): Promise<'started' | 'duplicate' | 'superseded' | 'relaunched'> {
		const current = await this.job();
		const action = onMessage(current, msg, Date.now());
		if (action === 'duplicate') {
			// The consumer took a slot for it: a job that is over gives it back at once
			if (current && current.status !== 'running' && current.status !== 'waiting_retry' && current.status !== 'stopping') await this.freeSlot(current);
			return 'duplicate';
		}
		if (action === 'relaunch') {
			log.warn('[Transcoder] Launch was lost (restarted mid-start); starting again', { videoId: msg.videoId, jobId: msg.jobId });
			await this.destroy().catch(() => undefined);
		}
		if (action === 'supersede' && current) {
			log.warn('[Transcoder] Newer job supersedes a running one', { videoId: msg.videoId, old: current.jobId, new: msg.jobId });
			await this.destroy().catch(() => undefined);
			await deletePrefix(bucketFor(this.env, current.prefix), `${current.prefix}/`).catch(() => undefined);
		}
		const job = newJob(msg, Date.now());
		await this.save(job);
		await this.ctx.storage.delete('progressReported');
		// Armed before the launch: if this object or its container restarts mid-start (a deploy),
		// the watchdog still finds the job and retries it (launch_lost) instead of it hanging
		await this.armWatchdog();
		try {
			await this.launch(job, true);
			// Started: the earlier failed starts no longer explain anything (the admin panel)
			await this.ctx.storage.delete('startFailure');
		} catch (error) {
			// Not started: forget it, so the queue's redelivery starts it again (not a "duplicate")
			await this.ctx.storage.delete('job');
			await this.destroy().catch(() => undefined);
			await this.freeSlot(job);
			throw error;
		}
		return action === 'supersede' ? 'superseded' : action === 'relaunch' ? 'relaunched' : 'started';
	}

	private async launch(job: JobState, firstAttempt = false): Promise<void> {
		// Startup timing (TranscodeStartup): was the container already up (warm reuse) or booted for this attempt
		const t0 = Date.now();
		const cold = !this.ctx.container?.running;
		await this.setOutboundByHosts({
			'source.internal': { method: 'source', params: { videoId: job.videoId } },
			'media.internal': { method: 'media', params: { prefix: job.prefix } },
			'control.internal': { method: 'control', params: { videoId: job.videoId, jobId: job.jobId } },
			...(job.reviewPrefix ? { 'review.internal': { method: 'review', params: { prefix: job.reviewPrefix } } } : {}),
			...(job.prebuilt ? { 'staging.internal': { method: 'staging', params: { prefix: job.prebuilt.prefix, rungs: job.prebuilt.rungs.join(',') } } } : {}),
		});
		await this.startAndWaitForPorts();
		const ready = Date.now();
		const res = await this.containerFetch('http://container/jobs', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jobId: job.jobId, prefix: job.prefix, attempt: job.attempt, videoId: job.videoId, rev: job.rev, ...(job.sha256 ? { sha256: job.sha256 } : {}), ...(job.review ? { review: job.review, reviewPrefix: job.reviewPrefix } : {}), ...(job.prebuilt ? { prebuilt: { rungs: job.prebuilt.rungs } } : {}) }),
		});
		if (res.status !== 202 && res.status !== 200) throw new Error(`container refused the job: HTTP ${res.status} ${await res.text()}`);
		job.launchedAt = Date.now();
		job.startup = startupTimes(job, cold, t0, ready, job.launchedAt, firstAttempt);
		await this.save(job);
		await this.armWatchdog();
		await this.report(job, { type: 'started', startup: job.startup });
	}

	/** The creator's staged renditions are done with once the job ends (used or not). */
	private async dropStaging(job: JobState): Promise<void> {
		if (!job.prebuilt) return;
		await deletePrefix(this.env.MEDIA_PRIVATE, job.prebuilt.prefix).catch((e) => log.warn('[Transcoder] Staging cleanup failed', { videoId: job.videoId, error: errorText(e) }));
	}

	/** From the container (control.internal). */
	async onContainerEvent(ev: ContainerEvent): Promise<void> {
		const job = await this.job();
		if (!job || job.jobId !== ev.jobId || job.status !== 'running') return;
		const now = Date.now();
		job.lastSeenAt = now;
		job.launchedAt ??= now;
		if (ev.type === 'progress') {
			// At most one report per 10 s, but every rung state change at once (the admin chips)
			const step = onProgressEvent(job, ev, await this.ctx.storage.get<{ at: number; states: string }>('progressReported'), now);
			await this.save(job);
			if (step.report) {
				await this.ctx.storage.put('progressReported', step.last);
				await this.report(job, step.report).catch(() => undefined);
			}
			return;
		}
		if (ev.type === 'started') {
			// FFmpeg is running (after the source probe): the last startup time, sent once
			if (job.startup && job.startup.ffmpegMs === undefined) {
				job.startup = { ...job.startup, ffmpegMs: Math.max(0, now - job.attemptStartedAt) };
				await this.save(job);
				await this.report(job, { type: 'started', startup: job.startup }).catch(() => undefined);
				return;
			}
			return this.save(job);
		}
		if (ev.type === 'ready') return this.finishReady(job, ev.result);
		const rungs = sanitizeRungs(ev.rungs);
		if (rungs) job.rungs = rungs;
		return this.finishFailed(job, ev.error, !!ev.fatal, ev.failure ?? {}, sanitizeSourceFacts(ev.sourceFacts));
	}

	private async finishReady(job: JobState, result: TranscodeResult): Promise<void> {
		const now = Date.now();
		job.priorSeconds = containerSeconds(job, now);
		job.status = 'ready';
		job.progress = 1;
		job.result = result;
		job.rungs = result.rungs.map((r) => ({ name: r.name, state: 'done' }));
		job.finishedAt = now;
		await this.save(job);
		await this.dropStaging(job);
		await this.report(job, { type: 'ready', result });
		await this.freeSlot(job);
		await this.stop().catch(() => undefined);
	}

	private async finishFailed(job: JobState, error: string, fatal: boolean, parts: FailureParts = {}, facts: TranscodeSourceFacts | null = null): Promise<void> {
		const now = Date.now();
		const failure = sanitizeFailure({
			stage: 'start',
			...parts,
			error,
			attempt: job.attempt,
			elapsedMs: now - job.attemptStartedAt,
			at: new Date(now).toISOString(),
			instanceId: this.ctx.id.toString(),
		} as TranscodeFailure);
		job.failure = failure;
		log.warn('[Transcoder] Attempt failed', { videoId: job.videoId, jobId: job.jobId, ...failure, stderrTail: undefined });
		job.priorSeconds = containerSeconds(job, now);
		job.error = error;
		// Whatever was not finished failed with the attempt (the chips show the reason)
		job.rungs = failRungs(job.rungs);
		// Before destroy(): its onStop must see our own teardown, not a crash. Without this the
		// stop re-entered here as 'container_stopped' and replaced the real error (2026-11-12:
		// a 'no source yet' wait gave up after 3 quick attempts instead of waiting for Bunny).
		job.status = 'stopping';
		await this.save(job);
		await deletePrefix(bucketFor(this.env, job.prefix), `${job.prefix}/`).catch((e) => log.warn('[Transcoder] Cleanup failed', { videoId: job.videoId, error: errorText(e) }));
		if (job.reviewPrefix) await deletePrefix(this.env.MEDIA_PRIVATE, job.reviewPrefix).catch(() => undefined);
		await this.destroy().catch(() => undefined);
		const infra = isInfraFailure(error, parts.exitCode);
		const next = onFailure(job, error, fatal, infra);
		if (next.retry) {
			job.status = 'waiting_retry';
			job.retryKeepsAttempt = !!next.keepsAttempt;
			job.infraRetries = next.keepsAttempt ? (job.infraRetries ?? 0) + 1 : 0;
			job.nextRetryAt = now + next.delaySeconds * 1000;
			await this.save(job);
			await this.report(job, { type: 'failed', error, final: false, failure, ...(facts ? { sourceFacts: facts } : {}), ...(job.rungs ? { rungs: job.rungs } : {}) });
			// Keeps its slot while it waits for the retry
			await this.holdSlot(job, (job.nextRetryAt ?? now) + LEASE_MS);
			await this.schedule(next.delaySeconds, 'retry', job.jobId);
			return;
		}
		job.status = 'failed';
		job.finishedAt = now;
		await this.save(job);
		await this.dropStaging(job);
		log.error('[Transcoder] Job failed', { videoId: job.videoId, jobId: job.jobId, attempt: job.attempt, error });
		await this.report(job, { type: 'failed', error, final: true, failure, ...(facts ? { sourceFacts: facts } : {}), ...(job.rungs ? { rungs: job.rungs } : {}) });
		await this.freeSlot(job);
	}

	/** schedule() callback: next attempt of a failed job. */
	async retry(jobId: string): Promise<void> {
		const job = await this.job();
		if (!job || job.jobId !== jobId || job.status !== 'waiting_retry') return;
		// A platform failure (deploy, restart) does not use up an attempt
		if (!job.retryKeepsAttempt) job.attempt += 1;
		delete job.retryKeepsAttempt;
		delete job.nextRetryAt;
		job.status = 'running';
		job.attemptStartedAt = Date.now();
		job.lastSeenAt = job.attemptStartedAt;
		job.progress = 0;
		delete job.rungs;
		delete job.launchedAt;
		delete job.startup;
		await this.ctx.storage.delete('progressReported');
		await this.save(job);
		await this.armWatchdog();
		try {
			await this.launch(job);
		} catch (error) {
			await this.finishFailed(job, `launch: ${errorText(error)}`, false, { stage: 'start' });
		}
	}

	/** schedule() callback every minute while a job runs; also flushes unsent reports. */
	async watchdog(): Promise<void> {
		await this.flushReports();
		const job = await this.job();
		if (!job || job.status !== 'running') return;
		let status: { status: string; jobId?: string; error?: string; result?: TranscodeResult } | null = null;
		try {
			const res = await this.containerFetch('http://container/status');
			if (res.ok) status = await res.json();
		} catch {
			status = null;
		}
		const now = Date.now();
		if (status?.jobId === job.jobId) {
			job.lastSeenAt = now;
			job.launchedAt ??= now;
			await this.save(job);
		}
		const verdict = watchdogVerdict(job, status, now);
		if (verdict.kind === 'ok') await this.holdSlot(job, now + LEASE_MS);
		if (verdict.kind === 'ready') return this.finishReady(job, verdict.result);
		if (verdict.kind === 'failed') return this.finishFailed(job, verdict.error, verdict.fatal, { stage: verdict.error === 'launch_lost' ? 'start' : 'container', stopReason: `watchdog: ${verdict.error}` });
		await this.schedule(WATCHDOG_SECONDS, 'watchdog');
	}

	/**
	 * One watchdog chain per object: schedule the next run unless one is already due later (each
	 * run deletes its own row after it returns and schedules the next itself).
	 */
	private async armWatchdog(): Promise<void> {
		if (hasWatchdogDue(this.ctx.storage.sql, Date.now())) return;
		await this.schedule(WATCHDOG_SECONDS, 'watchdog');
	}

	override async onStop(params?: { exitCode?: number; reason?: string }): Promise<void> {
		const job = await this.job();
		// Our own stop after ready/failed is expected; a running job means the container died
		if (job?.status === 'running' && Date.now() - job.attemptStartedAt > 10_000) {
			// A real crash (our own teardown marks the job 'stopping' first): exit code and reason are all the container leaves
			await this.finishFailed(job, 'container_stopped', false, {
				stage: 'container',
				...(params?.exitCode !== undefined ? { exitCode: params.exitCode } : {}),
				...(params?.reason ? { stopReason: params.reason } : {}),
			});
		}
	}

	override onError(error: unknown): unknown {
		log.error('[Transcoder] Container error', { error: errorText(error) });
		throw error;
	}

	/**
	 * Remux-only job (the public MP4 backfill, #1182): the progressive MP4 of a ready rendition,
	 * written beside its segments. Never touches the transcode job's state; waits ('busy') while a
	 * transcode of this video runs. The result goes to api-videos, which records it only when the
	 * rendition is still the same rev and access.
	 */
	async remuxMp4(msg: Mp4JobMessage): Promise<Mp4Outcome> {
		const current = await this.job();
		if (current && (current.status === 'running' || current.status === 'stopping' || current.status === 'waiting_retry')) return { outcome: 'busy' };
		const prefix = mediaPrefix(msg.access, msg.videoId, msg.rev);
		const startedAt = Date.now();
		const base = { videoId: msg.videoId, jobId: msg.jobId, rev: msg.rev, access: msg.access };
		let result: Mp4Outcome;
		try {
			await this.setOutboundByHosts({
				'rendition.internal': { method: 'rendition', params: { prefix } },
				'mp4.internal': { method: 'mp4', params: { prefix } },
			});
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/remux', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jobId: msg.jobId, prefix, rungs: msg.rungs }),
			});
			const body = (await res.json().catch(() => ({}))) as { mp4?: unknown; error?: string; fatal?: boolean };
			if (res.status === 409) return { outcome: 'busy' };
			const mp4 = sanitizeMp4(body.mp4);
			if (!res.ok || !mp4) throw Object.assign(new Error(body.error || `remux HTTP ${res.status}`), { fatal: !!body.fatal });
			await reportMp4Event(this.env, { ...base, type: 'ready', at: new Date().toISOString(), mp4, containerSeconds: Math.round((Date.now() - startedAt) / 1000) });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: !!(error as { fatal?: boolean })?.fatal };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/**
	 * Live recording review (VR9): frames and audio from a live stream's HLS VOD, no transcode. The
	 * DO is named `live:<streamId>`, so it never holds a video's transcode state. The result goes to
	 * api-videos, which queues the scan only while the stream's review is still `reviewId`.
	 */
	async extractLiveReview(msg: LiveReviewJobMessage): Promise<Mp4Outcome> {
		const source = liveVodSource(msg.vodUrl);
		if (!source) return { outcome: 'failed', error: 'bad recording url', fatal: true };
		const reviewPrefix = liveReviewPrefix(msg.streamId, msg.rev);
		let result: Mp4Outcome;
		try {
			await this.setOutboundByHosts({
				'vod.internal': { method: 'vod', params: { base: source.base } },
				'review.internal': { method: 'review', params: { prefix: reviewPrefix } },
			});
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ videoId: msg.streamId, rev: msg.rev, input: `http://vod.internal/${source.file}`, review: msg.review, reviewPrefix }),
			});
			const body = (await res.json().catch(() => ({}))) as { manifestKey?: unknown; error?: string; fatal?: boolean };
			if (res.status === 409) return { outcome: 'busy' };
			if (!res.ok || typeof body.manifestKey !== 'string' || !body.manifestKey.startsWith(reviewPrefix)) throw Object.assign(new Error(body.error || `review HTTP ${res.status}`), { fatal: !!body.fatal });
			await reportLiveReviewMedia(this.env, msg.streamId, { reviewId: msg.reviewId, manifestKey: body.manifestKey });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: !!(error as { fatal?: boolean })?.fatal };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/**
	 * Captions (AUN-CAPTIONS §5.2): a video's audio only, from the kept original or Bunny's source,
	 * as 16 kHz chunks under captions-work/<jobId>/ (no transcode). The DO is named
	 * `captions:<videoId>`, so it never holds a video's transcode state. api-videos then queues the
	 * transcription.
	 */
	async extractCaptionAudio(msg: CaptionAudioJobMessage): Promise<Mp4Outcome> {
		let result: Mp4Outcome;
		try {
			await this.setOutboundByHosts({
				'source.internal': { method: 'source', params: { videoId: msg.videoId } },
				'review.internal': { method: 'review', params: { prefix: msg.out } },
			});
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/audio', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jobId: msg.jobId, videoId: msg.videoId, input: 'http://source.internal/src', prefix: msg.out }),
			});
			const body = (await res.json().catch(() => ({}))) as { manifestKey?: unknown; error?: string; fatal?: boolean };
			if (res.status === 409) return { outcome: 'busy' };
			if (!res.ok || typeof body.manifestKey !== 'string' || !body.manifestKey.startsWith(msg.out)) throw Object.assign(new Error(body.error || `audio HTTP ${res.status}`), { fatal: !!body.fatal });
			await reportCaptionAudio(this.env, msg.jobId, { ok: true, manifestKey: body.manifestKey });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: !!(error as { fatal?: boolean })?.fatal };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/**
	 * Release smoke (GET /priv/_selftest on the DO `selftest`): one real container start, timed, then
	 * stopped. Limited per deployed version by selfTestDue (the route is public); never touches a job's state.
	 */
	async selfTest(version?: string): Promise<SelfTestResult> {
		const last = await this.ctx.storage.get<SelfTestResult>('selftest');
		if (!selfTestDue(last, Date.now(), version)) return { ...last!, cached: true };
		const started = Date.now();
		const counts = selfTestRuns(last, version, started);
		const base = () => ({ startMs: Date.now() - started, at: new Date().toISOString(), version, ...counts });
		let result: SelfTestResult;
		let detail = '';
		try {
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/status');
			const body = (await res.json().catch(() => null)) as { status?: string } | null;
			const ok = res.ok && body?.status === 'idle';
			if (!ok) detail = `status HTTP ${res.status} ${body?.status ?? ''}`.trim();
			result = { ok, ...base(), ...(ok ? {} : { error: 'container refused the job' }) };
		} catch (error) {
			detail = errorText(error).slice(0, 200);
			const reason = startFailureReason(detail);
			result = reason === 'capacity full'
				? { ok: true, ...base(), skipped: 'capacity full: every instance is transcoding' }
				: { ok: false, ...base(), error: reason };
		} finally {
			await this.stop().catch(() => undefined);
		}
		if (!result.ok) log.error('[Transcoder] Self-test: the container did not start', { ...result, detail });
		await this.ctx.storage.put('selftest', result);
		return result;
	}

	/**
	 * One audio track (AUN-MULTI-AUDIO MA5): the uploaded file or a stream of the video's own file,
	 * padded or cut to the video, → track.m4a in the originals bucket; review chunks when asked. The
	 * DO is named `audio:<videoId>`, so it never holds the video's transcode state.
	 */
	async prepareAudioTrack(msg: AudioTrackJobMessage): Promise<Mp4Outcome> {
		const out = audioTrackFileKey(msg.videoId, msg.trackId);
		let result: Mp4Outcome;
		try {
			const fromUpload = msg.source.type === 'upload';
			await this.setOutboundByHosts({
				...(msg.source.type === 'upload'
					? { 'audioin.internal': { method: 'audioin', params: { videoId: msg.videoId, trackId: msg.trackId, uploadId: msg.source.uploadId, bytes: msg.source.bytes } } }
					: { 'source.internal': { method: 'source', params: { videoId: msg.videoId } } }),
				'audioout.internal': { method: 'audioout', params: { key: out } },
				...(msg.reviewPrefix ? { 'review.internal': { method: 'review', params: { prefix: msg.reviewPrefix } } } : {}),
			});
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/audio-track', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jobId: msg.jobId,
					videoId: msg.videoId,
					trackId: msg.trackId,
					input: fromUpload ? 'http://audioin.internal/src' : 'http://source.internal/src',
					...(msg.source.type === 'source_stream' ? { stream: msg.source.streamIndex } : {}),
					durationSeconds: msg.durationSeconds,
					out,
					...(msg.reviewPrefix ? { reviewPrefix: msg.reviewPrefix } : {}),
				}),
			});
			const body = (await res.json().catch(() => ({}))) as { durationSeconds?: unknown; reviewManifestKey?: unknown; error?: string; fatal?: boolean };
			if (res.status === 409) return { outcome: 'busy' };
			if (!res.ok) throw Object.assign(new Error(body.error || `audio track HTTP ${res.status}`), { fatal: !!body.fatal });
			const manifest = typeof body.reviewManifestKey === 'string' && msg.reviewPrefix && body.reviewManifestKey.startsWith(msg.reviewPrefix) ? body.reviewManifestKey : undefined;
			await reportAudioTrack(this.env, msg.videoId, msg.trackId, { jobId: msg.jobId, ok: true, durationSeconds: Number(body.durationSeconds) || msg.durationSeconds, ...(manifest ? { reviewManifestKey: manifest } : {}) });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: !!(error as { fatal?: boolean })?.fatal };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/** The source file's audio streams (multi-track sources), on the DO `audio:<videoId>`. */
	async probeAudio(msg: AudioProbeJobMessage): Promise<Mp4Outcome> {
		let result: Mp4Outcome;
		try {
			await this.setOutboundByHosts({ 'source.internal': { method: 'source', params: { videoId: msg.videoId } } });
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/audio-probe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jobId: msg.jobId, videoId: msg.videoId }),
			});
			const body = (await res.json().catch(() => ({}))) as { streams?: unknown; error?: string };
			if (!res.ok) throw new Error(body.error || `audio probe HTTP ${res.status}`);
			await reportAudioProbe(this.env, msg.videoId, { jobId: msg.jobId, ok: true, streams: sanitizeDetectedStreams(body.streams) });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: false };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/**
	 * The demuxed multi-audio package (MA2/MA3) of a ready rendition, beside its files under a/ and
	 * master_a<version>.m3u8. On the video's own DO: waits ('busy') while a transcode runs. The result
	 * goes to api-videos, which plays it only while the rendition is still the same rev and access.
	 */
	async packageAudio(msg: AudioPackageJobMessage): Promise<Mp4Outcome> {
		const current = await this.job();
		if (current && (current.status === 'running' || current.status === 'stopping' || current.status === 'waiting_retry')) return { outcome: 'busy' };
		const prefix = mediaPrefix(msg.access, msg.videoId, msg.rev);
		let result: Mp4Outcome;
		try {
			await this.setOutboundByHosts({
				'rendition.internal': { method: 'rendition', params: { prefix } },
				'trackin.internal': { method: 'trackin', params: { videoId: msg.videoId, trackIds: msg.tracks.map((t) => t.id).filter((id) => id !== 'orig') } },
				'pkg.internal': { method: 'pkg', params: { prefix } },
			});
			await this.startAndWaitForPorts();
			const res = await this.containerFetch('http://container/audio-package', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jobId: msg.jobId, prefix, version: msg.version, tracks: msg.tracks }),
			});
			const body = (await res.json().catch(() => ({}))) as { master?: unknown; trackIds?: unknown; error?: string; fatal?: boolean };
			if (res.status === 409) return { outcome: 'busy' };
			const trackIds = Array.isArray(body.trackIds) ? body.trackIds.filter((id): id is string => typeof id === 'string' && msg.tracks.some((t) => t.id === id)) : [];
			if (!res.ok || body.master !== `master_a${msg.version}.m3u8` || !trackIds.length) throw Object.assign(new Error(body.error || `audio package HTTP ${res.status}`), { fatal: !!body.fatal });
			await reportAudioPackage(this.env, msg.videoId, { jobId: msg.jobId, rev: msg.rev, access: msg.access, ok: true, master: body.master, trackIds });
			result = { outcome: 'ready' };
		} catch (error) {
			result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: !!(error as { fatal?: boolean })?.fatal };
		} finally {
			await this.stop().catch(() => undefined);
		}
		return result;
	}

	/** Admin/diagnostics: the job as stored. */
	async jobState(): Promise<JobState | null> {
		return (await this.job()) ?? null;
	}

	/**
	 * The queue consumer could not start `jobId` (handleTranscodeStart): kept so the admin's
	 * troubleshooting panel shows the delivery count, the next try and why (the job itself is not
	 * stored until a start succeeds).
	 */
	async noteStartFailure(jobId: string, error: string, deliveries: number): Promise<void> {
		const current = await this.job();
		// A newer job already runs here: an older message's failure explains nothing
		if (current && current.jobId !== jobId && (current.status === 'running' || current.status === 'waiting_retry')) return;
		await this.ctx.storage.put('startFailure', startFailureNote(jobId, error, deliveries, Date.now()));
	}

	/** Admin troubleshooting view: the job, the last failed start and this object's id (the Containers API names it). */
	async troubleshootState(): Promise<{ job: TranscoderJobView | null; startFailure: TranscodeStartFailure | null; durableObjectId: string }> {
		const job = await this.job();
		const startFailure = (await this.ctx.storage.get<TranscodeStartFailure>('startFailure')) ?? null;
		return { job: job ? jobView(job) : null, startFailure, durableObjectId: this.ctx.id.toString() };
	}

	/**
	 * Admin "Cancel" (videos admin → Delivery): stops the container, marks the job cancelled (so a
	 * pending retry and any later delivery of it do nothing) and deletes its partial output. A job
	 * that never started gets a cancelled stand-in for the same reason. Idempotent.
	 */
	async cancelJob(input: { videoId: string; jobId: string; rev: string; access: 'pub' | 'priv'; queuedAt: string }): Promise<'cancelled' | 'already_finished'> {
		const current = await this.job();
		const now = Date.now();
		if (current && current.jobId === input.jobId) {
			if (current.status === 'ready' || current.status === 'failed') return 'already_finished';
			if (current.status === 'cancelled') return 'cancelled';
			current.priorSeconds = containerSeconds(current, now);
			// Before destroy(): onStop must see our own teardown, not a crash
			current.status = 'cancelled';
			current.error = 'cancelled';
			current.finishedAt = now;
			delete current.nextRetryAt;
			await this.save(current);
			await this.destroy().catch(() => undefined);
			await deletePrefix(bucketFor(this.env, current.prefix), `${current.prefix}/`).catch((e) => log.warn('[Transcoder] Cancel cleanup failed', { videoId: current.videoId, error: errorText(e) }));
			if (current.reviewPrefix) await deletePrefix(this.env.MEDIA_PRIVATE, current.reviewPrefix).catch(() => undefined);
			await this.freeSlot(current);
		} else {
			// Never started here (or an older job is stored): a stand-in makes later deliveries duplicates
			const stub = cancelledJob(input, now);
			await this.save(stub);
			await deletePrefix(bucketFor(this.env, stub.prefix), `${stub.prefix}/`).catch(() => undefined);
		}
		await this.ctx.storage.delete('startFailure');
		log.warn('[Transcoder] Job cancelled by an admin', { videoId: input.videoId, jobId: input.jobId });
		return 'cancelled';
	}

	/** Admin "Retry now": runs a scheduled retry at once. Anything else is left alone. */
	async retryNow(jobId: string): Promise<'started' | 'not_waiting'> {
		const job = await this.job();
		if (!job || job.jobId !== jobId || job.status !== 'waiting_retry') return 'not_waiting';
		await this.retry(jobId);
		return 'started';
	}

	// -----------------------------------------------------------------------
	// Slots (the admin's max concurrent transcodes, slot-state.ts): never fail the job over them
	// -----------------------------------------------------------------------

	private async holdSlot(job: JobState, until: number): Promise<void> {
		await slotsOf(this.env)
			.renew(job.videoId, job.jobId, until)
			.catch((e: unknown) => log.warn('[Transcoder] Could not renew the slot', { videoId: job.videoId, jobId: job.jobId, error: errorText(e) }));
	}

	private async freeSlot(job: JobState): Promise<void> {
		await slotsOf(this.env)
			.release(job.videoId, job.jobId)
			.catch((e: unknown) => log.warn('[Transcoder] Could not free the slot', { videoId: job.videoId, jobId: job.jobId, error: errorText(e) }));
	}

	// -----------------------------------------------------------------------
	// Reports to api-videos: kept until delivered (the watchdog resends)
	// -----------------------------------------------------------------------

	private async report(job: JobState, ev: Pick<TranscodeJobEvent, 'type' | 'progress' | 'result' | 'error' | 'final' | 'failure' | 'sourceFacts' | 'rungs' | 'startup'>): Promise<void> {
		const event: TranscodeJobEvent = {
			videoId: job.videoId,
			jobId: job.jobId,
			at: new Date().toISOString(),
			attempt: job.attempt,
			containerSeconds: containerSeconds(job, Date.now()),
			instanceType: this.env.TRANSCODER_INSTANCE ?? 'standard-4',
			...ev,
		};
		try {
			await reportEvent(this.env, event);
		} catch (error) {
			if (ev.type === 'progress') return;
			log.warn('[Transcoder] Report failed; will resend', { videoId: job.videoId, type: ev.type, error: errorText(error) });
			const pending = (await this.ctx.storage.get<TranscodeJobEvent[]>('pendingReports')) ?? [];
			pending.push(event);
			await this.ctx.storage.put('pendingReports', pending.slice(-10));
			if (job.status !== 'running') await this.schedule(WATCHDOG_SECONDS, 'watchdog');
		}
	}

	private async flushReports(): Promise<void> {
		const pending = (await this.ctx.storage.get<TranscodeJobEvent[]>('pendingReports')) ?? [];
		if (!pending.length) return;
		const left: TranscodeJobEvent[] = [];
		for (const ev of pending) {
			try {
				await reportEvent(this.env, ev);
			} catch {
				left.push(ev);
			}
		}
		await this.ctx.storage.put('pendingReports', left);
		const job = await this.job();
		if (left.length && job?.status !== 'running') await this.schedule(5 * WATCHDOG_SECONDS, 'watchdog');
	}
}

// Through Container's static setter, which registers them by name for setOutboundByHosts
Transcoder.outboundHandlers = Transcoder.handlers as never;
