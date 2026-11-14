/**
 * /internal/csam/* — the CSAM response's platform side (docs/specs/CSAM-RESPONSE.md).
 *
 * Behind the INTERNAL_API_KEY check of every /internal/* path (src/index.ts): only admin-api
 * calls these, after it has checked that the caller is a super admin (and step-up for evidence),
 * and it writes the case's access log itself. Evidence leaves only as an attachment download of
 * an opaque type: never something a browser renders inline.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { CSAM_ITEM_KINDS, type CsamResolution } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { retryJob } from '../lib/admin/jobs';
import { resolveByHand, resolveCsamUrl } from '../lib/csam/resolve';
import { CSAM_ACTOR, containJobOf, startContainment, validResolution, type ContainEnv } from '../lib/csam/contain';
import { deleteEvidence, openEvidenceFile, readManifest } from '../lib/csam/evidence';
import { EvidenceKeyError } from '../lib/csam/crypto';

type Env = { Bindings: ContainEnv };
const app = new Hono<Env>();

const CASE_ID = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const FILE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

const Resolution = z.object({
	kind: z.enum(CSAM_ITEM_KINDS),
	videoId: ID.optional(),
	channelId: ID.nullable().optional(),
	postId: ID.optional(),
	imagePath: z.string().max(1024).startsWith('/').optional(),
	imageField: z.enum(['avatarUrl', 'coverUrl']).optional(),
	uploaderId: ID.nullable(),
});

const ByHand = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('video'), videoId: ID }),
	z.object({ kind: z.literal('post'), channelId: ID, postId: ID }),
	z.object({ kind: z.enum(['profile_image', 'channel_image']), id: ID, field: z.enum(['avatarUrl', 'coverUrl']) }),
]);

class BadRequest extends Error {
	constructor(public status: 400 | 404 | 409, public code: string) {
		super(code);
	}
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
	const result = schema.safeParse(value);
	if (!result.success) throw new BadRequest(400, 'invalid_request');
	return result.data;
}
const body = async (c: Context<Env>) => c.req.json().catch(() => ({}));
const ok = (c: Context<Env>, result: unknown) => c.json({ success: true, result });
const actor = (c: Context<Env>) => c.req.header('X-Admin-Actor') || CSAM_ACTOR;

app.onError((error, c) => {
	if (error instanceof BadRequest) return c.json({ success: false, code: error.code }, error.status);
	if (error instanceof EvidenceKeyError) {
		logger.error('[CSAM] Evidence key is not configured', { path: c.req.path });
		return c.json({ success: false, code: 'evidence_key_missing' }, 503);
	}
	logger.error('[CSAM] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'internal_error' }, 500);
});

/** What a pasted URL maps to (no side effects). */
app.post('/resolve', async (c) => {
	const { url } = parse(z.object({ url: z.string().min(1).max(4096) }), await body(c));
	return ok(c, await resolveCsamUrl(c.env, url));
});

/** A super admin's mapping of an unmapped case. */
app.post('/resolve-by-hand', async (c) => {
	const input = parse(ByHand, await body(c));
	const resolution = await resolveByHand(c.env, input as Parameters<typeof resolveByHand>[1]);
	if (!resolution) throw new BadRequest(404, 'not_found');
	return ok(c, resolution);
});

/** Hide at once, then queue the takedown job. Idempotent per case: a second call returns the job. */
app.post('/contain', async (c) => {
	const input = parse(z.object({ caseId: CASE_ID, matchedUrl: z.string().min(1).max(4096), resolution: Resolution }), await body(c));
	const resolution = input.resolution as CsamResolution;
	if (!validResolution(resolution)) throw new BadRequest(400, 'invalid_resolution');
	const existing = await containJobOf(c.env, input.caseId);
	if (existing) return ok(c, { job: existing, existing: true });
	const out = await startContainment(c.env, { caseId: input.caseId, matchedUrl: input.matchedUrl, resolution, actorId: actor(c) });
	logger.info('[CSAM] Containment started', { caseId: input.caseId, kind: resolution.kind, jobId: out.job.id, hidden: out.hide.hidden, cdn: out.hide.cdn });
	return ok(c, out);
});

/** The Errors page's Retry (SERVICE_RETRIES) and the case page's: a failed takedown runs again from its phase. */
app.post('/retry', async (c) => {
	const { caseId } = parse(z.object({ caseId: CASE_ID }), await body(c));
	const job = await containJobOf(c.env, caseId);
	if (!job) throw new BadRequest(404, 'job_not_found');
	if (job.status !== 'failed') return ok(c, { job, retried: false });
	return ok(c, { job: await retryJob(c.env, job.id), retried: true });
});

app.get('/cases/:caseId/job', async (c) => {
	const caseId = parse(CASE_ID, c.req.param('caseId'));
	return ok(c, { job: await containJobOf(c.env, caseId) });
});

/** The case's evidence list (names, sizes, hashes; no content). */
app.get('/cases/:caseId/manifest', async (c) => {
	const caseId = parse(CASE_ID, c.req.param('caseId'));
	const manifest = await readManifest(c.env, caseId);
	if (!manifest) throw new BadRequest(404, 'not_found');
	return ok(c, manifest);
});

/** One evidence file, decrypted and integrity-checked as it streams. Attachment only. */
app.get('/cases/:caseId/files/:name', async (c) => {
	const caseId = parse(CASE_ID, c.req.param('caseId'));
	const name = c.req.param('name');
	if (!FILE_NAME.test(name)) throw new BadRequest(400, 'invalid_request');
	const opened = await openEvidenceFile(c.env, caseId, name);
	if (!opened) throw new BadRequest(404, 'not_found');
	return new Response(opened.body, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': `attachment; filename="${caseId}-${name}"`,
			'Content-Length': String(opened.file.bytes),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-store, private',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Evidence-Sha256-Chunks': String(opened.file.chunkSha256.length),
		},
	});
});

/** The retention sweep (admin-api decides when: never before the legal minimum, never under a hold). */
app.delete('/cases/:caseId/evidence', async (c) => {
	const caseId = parse(CASE_ID, c.req.param('caseId'));
	return ok(c, { deleted: await deleteEvidence(c.env, caseId) });
});

export default app;
