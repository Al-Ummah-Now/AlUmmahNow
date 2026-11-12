/**
 * One FFmpeg container per video (Durable Object named by the video id), so a
 * redelivered or retried queue message reaches the instance that already has
 * the job. The container has no internet: it reads the source, writes R2 and
 * reports progress only through the outbound handlers below, each bound at job
 * start to this job's video, prefix and id.
 */
import { Container, type OutboundHandlerContext } from '@cloudflare/containers';
import { mediaCacheControl, mediaContentType, type TranscodeJobEvent, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';
import { bucketFor, errorText, log, type Env } from './env';
import { containerSeconds, keyAllowed, newJob, onFailure, onMessage, watchdogVerdict, WATCHDOG_SECONDS, type JobState } from './jobs';
import { reportEvent, sourceUrl } from './videos-api';

type ContainerEvent =
	| { type: 'started'; jobId: string }
	| { type: 'progress'; jobId: string; progress: number }
	| { type: 'ready'; jobId: string; result: TranscodeResult }
	| { type: 'failed'; jobId: string; error: string; fatal?: boolean };

const PROGRESS_REPORT_MS = 60_000;

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

	static override outboundHandlers = {
		/** GET http://source.internal/src (Range passed through) → the original upload */
		async source(req: Request, env: Env, ctx: OutboundHandlerContext<{ videoId: string }>): Promise<Response> {
			if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
			const url = await sourceUrl(env, ctx.params.videoId);
			if (!url) return new Response('source_missing', { status: 404 });
			const headers = new Headers();
			const range = req.headers.get('range');
			if (range) headers.set('range', range);
			const res = await fetch(url, { method: req.method, headers });
			if (res.status === 404 || res.status === 403) return new Response('source_missing', { status: 404 });
			return res;
		},
		/** PUT http://media.internal/<key> → R2, only under this job's prefix */
		async media(req: Request, env: Env, ctx: OutboundHandlerContext<{ prefix: string }>): Promise<Response> {
			const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
			if (req.method !== 'PUT') return new Response('method', { status: 405 });
			if (!keyAllowed(ctx.params.prefix, key)) return new Response('key outside the job', { status: 403 });
			const body = await req.arrayBuffer();
			await bucketFor(env, key).put(key, body, { httpMetadata: { contentType: mediaContentType(key), cacheControl: mediaCacheControl(key) } });
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

	/** Queue consumer entry. Idempotent per job id. */
	async startJob(msg: TranscodeJobMessage): Promise<'started' | 'duplicate' | 'superseded'> {
		const current = await this.job();
		const action = onMessage(current, msg);
		if (action === 'duplicate') return 'duplicate';
		if (action === 'supersede' && current) {
			log.warn('[Transcoder] Newer job supersedes a running one', { videoId: msg.videoId, old: current.jobId, new: msg.jobId });
			await this.destroy().catch(() => undefined);
			await deletePrefix(bucketFor(this.env, current.prefix), `${current.prefix}/`).catch(() => undefined);
		}
		const job = newJob(msg, Date.now());
		await this.save(job);
		await this.launch(job);
		return action === 'supersede' ? 'superseded' : 'started';
	}

	private async launch(job: JobState): Promise<void> {
		await this.setOutboundByHosts({
			'source.internal': { method: 'source', params: { videoId: job.videoId } },
			'media.internal': { method: 'media', params: { prefix: job.prefix } },
			'control.internal': { method: 'control', params: { videoId: job.videoId, jobId: job.jobId } },
		});
		await this.startAndWaitForPorts();
		const res = await this.containerFetch('http://container/jobs', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jobId: job.jobId, prefix: job.prefix, attempt: job.attempt }),
		});
		if (res.status !== 202 && res.status !== 200) throw new Error(`container refused the job: HTTP ${res.status} ${await res.text()}`);
		await this.schedule(WATCHDOG_SECONDS, 'watchdog');
		await this.report(job, { type: 'started' });
	}

	/** From the container (control.internal). */
	async onContainerEvent(ev: ContainerEvent): Promise<void> {
		const job = await this.job();
		if (!job || job.jobId !== ev.jobId || job.status !== 'running') return;
		const now = Date.now();
		job.lastSeenAt = now;
		if (ev.type === 'progress') {
			const last = (await this.ctx.storage.get<number>('progressReportedAt')) ?? 0;
			job.progress = ev.progress;
			await this.save(job);
			if (now - last > PROGRESS_REPORT_MS) {
				await this.ctx.storage.put('progressReportedAt', now);
				await this.report(job, { type: 'progress', progress: ev.progress }).catch(() => undefined);
			}
			return;
		}
		if (ev.type === 'started') return this.save(job);
		if (ev.type === 'ready') return this.finishReady(job, ev.result);
		return this.finishFailed(job, ev.error, !!ev.fatal);
	}

	private async finishReady(job: JobState, result: TranscodeResult): Promise<void> {
		const now = Date.now();
		job.priorSeconds = containerSeconds(job, now);
		job.status = 'ready';
		job.progress = 1;
		job.result = result;
		job.finishedAt = now;
		await this.save(job);
		await this.report(job, { type: 'ready', result });
		await this.stop().catch(() => undefined);
	}

	private async finishFailed(job: JobState, error: string, fatal: boolean): Promise<void> {
		const now = Date.now();
		job.priorSeconds = containerSeconds(job, now);
		job.error = error;
		await deletePrefix(bucketFor(this.env, job.prefix), `${job.prefix}/`).catch((e) => log.warn('[Transcoder] Cleanup failed', { videoId: job.videoId, error: errorText(e) }));
		await this.destroy().catch(() => undefined);
		const next = onFailure(job, error, fatal);
		if (next.retry) {
			job.status = 'waiting_retry';
			await this.save(job);
			await this.report(job, { type: 'failed', error, final: false });
			await this.schedule(next.delaySeconds, 'retry', job.jobId);
			return;
		}
		job.status = 'failed';
		job.finishedAt = now;
		await this.save(job);
		log.error('[Transcoder] Job failed', { videoId: job.videoId, jobId: job.jobId, attempt: job.attempt, error });
		await this.report(job, { type: 'failed', error, final: true });
	}

	/** schedule() callback: next attempt of a failed job. */
	async retry(jobId: string): Promise<void> {
		const job = await this.job();
		if (!job || job.jobId !== jobId || job.status !== 'waiting_retry') return;
		job.attempt += 1;
		job.status = 'running';
		job.attemptStartedAt = Date.now();
		job.lastSeenAt = job.attemptStartedAt;
		job.progress = 0;
		await this.save(job);
		try {
			await this.launch(job);
		} catch (error) {
			await this.finishFailed(job, `launch: ${errorText(error)}`, false);
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
			await this.save(job);
		}
		const verdict = watchdogVerdict(job, status, now);
		if (verdict.kind === 'ready') return this.finishReady(job, verdict.result);
		if (verdict.kind === 'failed') return this.finishFailed(job, verdict.error, verdict.fatal);
		await this.schedule(WATCHDOG_SECONDS, 'watchdog');
	}

	override async onStop(): Promise<void> {
		const job = await this.job();
		// Our own stop after ready/failed is expected; a running job means the container died
		if (job?.status === 'running' && Date.now() - job.attemptStartedAt > 10_000) {
			await this.finishFailed(job, 'container_stopped', false);
		}
	}

	override onError(error: unknown): unknown {
		log.error('[Transcoder] Container error', { error: errorText(error) });
		throw error;
	}

	/** Admin/diagnostics: the job as stored. */
	async jobState(): Promise<JobState | null> {
		return (await this.job()) ?? null;
	}

	// -----------------------------------------------------------------------
	// Reports to api-videos: kept until delivered (the watchdog resends)
	// -----------------------------------------------------------------------

	private async report(job: JobState, ev: Pick<TranscodeJobEvent, 'type' | 'progress' | 'result' | 'error' | 'final'>): Promise<void> {
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
