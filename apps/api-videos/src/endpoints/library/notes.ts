/**
 * Private video notes (wiki Epic 21 §4 21.8, owner decision E21-D9). Signed-in only; gated by the
 * `studyNotes` feature switch (FEATURE_ROUTES), so while it is off every route answers 404
 * `feature_off` before validation.
 *
 * GET    /api/library/notes?videoId=&cursor=     a video's notes in time order
 * GET    /api/library/notes?since=&cursor=       sync feed: changes since a time, tombstones included
 * GET    /api/library/notes?cursor=              Library › Notes: most recently changed first
 * POST   /api/library/notes                      { id?, videoId, startMs, endMs?, body, updatedAt? }
 * PUT    /api/library/notes/:id                  { startMs, endMs?, body, updatedAt? } last write wins
 * DELETE /api/library/notes/:id                  tombstone
 * DELETE /api/library/notes?videoId=             tombstone all (or one video's)
 * GET    /api/library/notes/export.md?videoId=   Markdown export, generated on demand
 */
import { z } from 'zod';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';
import { resolveCreator } from '../../lib/creatorTiers';
import { loadVideoRecord, videoReadAccess } from '../../lib/videoReadAccess';
import { webOrigin } from '../../lib/social/content';
import {
	checkNote,
	createNote,
	deleteAllNotes,
	deleteNote,
	exportNotes,
	listChangedNotes,
	listRecentNotes,
	listVideoNotes,
	notesMarkdown,
	readNote,
	NOTE_BODY_MAX,
	NOTES_PAGE_MAX,
	underNoteLimit,
	updateNote,
	writeTime,
	type ExportVideo,
} from '../../lib/notes';

/** Most notes one export holds; the tier limit is usually lower */
const EXPORT_MAX = 5000;
/** Most distinct videos an export reads titles for; the rest are listed without a title */
const EXPORT_VIDEO_READS = 200;

const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const Note = z.object({
	id: z.string(),
	videoId: z.string(),
	startMs: z.number().int(),
	endMs: z.number().int().nullable(),
	body: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	deleted: z.boolean(),
});
const Page = z.object({ success: z.literal(true), data: z.object({ items: z.array(Note), nextCursor: z.string().nullable() }) });
const NoteIdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
const Time = z.number().int().min(0);
const IsoTime = z.string().datetime().optional();
const NoteFields = {
	startMs: Time,
	endMs: Time.nullable().optional(),
	body: z.string().max(NOTE_BODY_MAX * 2),
	updatedAt: IsoTime.describe('When the edit was made on the device; last write wins'),
};

function db(c: AppContext): D1Database {
	return c.env.SEARCH_DB as D1Database;
}

function noStore(c: AppContext) {
	c.header('Cache-Control', 'private, no-store');
}

function invalid(c: AppContext, error: string) {
	return apiError(c, 400, 'invalid_request', { error, field: error === 'invalid_time' ? 'startMs' : 'body' });
}

export class NotesList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'List private video notes',
			description:
				'With `videoId`: that video\'s notes in time order. With `since`: every change after that time, oldest first, deleted notes included (`deleted: true`), for sync; omit both `since` and `videoId` with `sync=true` to read every note from the start. Otherwise the most recently changed notes first. Notes are private to the signed-in user.',
			request: {
				query: z.object({
					videoId: z.string().max(64).optional(),
					since: z.string().datetime().optional(),
					sync: z.enum(['true', 'false']).optional(),
					cursor: z.string().max(512).optional(),
					limit: z.coerce.number().int().min(1).max(NOTES_PAGE_MAX).optional().default(50),
				}),
			},
			responses: { '200': { description: 'A page of notes', content: { 'application/json': { schema: Page } } } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const page = query.videoId
			? await listVideoNotes(db(c), userId, query.videoId, query.limit, query.cursor)
			: query.since || query.sync === 'true'
				? // Stored times are toISOString() (milliseconds, Z): compare like with like
					await listChangedNotes(db(c), userId, query.since ? new Date(query.since).toISOString() : undefined, query.limit, query.cursor)
				: await listRecentNotes(db(c), userId, query.limit, query.cursor);
		noStore(c);
		return c.json({ success: true as const, data: page });
	}
}

export class NoteCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'Add a private note at a time in a video',
			description:
				'`id` may be chosen by the client (8 to 64 of A–Z, a–z, 0–9, _ and -) so an offline device can retry safely; sending it again applies as an edit when newer. The note limit comes from the account\'s tier.',
			request: {
				body: {
					content: {
						'application/json': {
							schema: z.object({ id: NoteIdParam.shape.id.optional(), videoId: z.string().min(1).max(64), ...NoteFields }),
						},
					},
				},
			},
			responses: {
				'201': { description: 'The stored note', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Note }) } } },
				'400': { description: 'invalid_time or invalid_body', content: Err },
				'404': { description: 'The video is not available to this user', content: Err },
				'409': { description: 'notes_limit: the tier\'s note limit is reached', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const checked = checkNote(body.startMs, body.endMs, body.body);
		if ('error' in checked) return invalid(c, checked.error);
		const video = await loadVideoRecord(c.env as never, body.videoId);
		if (!(await videoReadAccess(c.env, video as never, userId))) return apiError(c, 404, 'video_not_found');
		// A retry of a note this user already has (offline sync) is an edit: no limit check, same video only
		const existing = body.id ? await readNote(db(c), userId, body.id) : null;
		if (existing && existing.video_id !== body.videoId) return apiError(c, 409, 'conflict', { error: 'note_on_other_video' });
		if (!existing) {
			const roles = (this.getAuth(c) as { payload?: { roles?: string[] } }).payload?.roles ?? null;
			const creator = await resolveCreator(db(c), { userId, roles });
			const max = creator.via === 'super_admin' || creator.tier?.unlimited ? null : creator.tier?.notesMax === undefined ? 1000 : creator.tier.notesMax;
			if (!(await underNoteLimit(db(c), userId, max))) return apiError(c, 409, 'notes_limit', { limit: max });
		}
		const note = await createNote(db(c), userId, {
			id: body.id ?? crypto.randomUUID(),
			videoId: body.videoId,
			startMs: body.startMs,
			endMs: body.endMs ?? null,
			body: checked.body,
			updatedAt: writeTime(body.updatedAt),
		});
		// An id another user already holds is never touched: that write stores nothing for this user
		if (!note) return apiError(c, 409, 'conflict', { error: 'note_id_taken' });
		logger.debug('[Notes] Saved', { userId, videoId: body.videoId, noteId: note.id });
		noStore(c);
		return c.json({ success: true as const, data: note }, 201);
	}
}

export class NoteUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'Edit a private note (last write wins)',
			description: 'The edit applies only when its `updatedAt` is newer than the stored change; the response is the stored note and `applied`.',
			request: {
				params: NoteIdParam,
				body: { content: { 'application/json': { schema: z.object(NoteFields) } } },
			},
			responses: {
				'200': { description: 'The stored note', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Note, applied: z.boolean() }) } } },
				'400': { description: 'invalid_time or invalid_body', content: Err },
				'404': { description: 'No such note for this user', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const checked = checkNote(body.startMs, body.endMs, body.body);
		if ('error' in checked) return invalid(c, checked.error);
		const { note, applied } = await updateNote(db(c), userId, params.id, {
			startMs: body.startMs,
			endMs: body.endMs ?? null,
			body: checked.body,
			updatedAt: writeTime(body.updatedAt),
		});
		if (!note) return apiError(c, 404, 'not_found', { error: 'note_not_found' });
		noStore(c);
		return c.json({ success: true as const, data: note, applied });
	}
}

export class NoteDelete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'Delete a private note',
			request: { params: NoteIdParam },
			responses: { '200': { description: 'Deleted (or already deleted)', content: { 'application/json': { schema: z.object({ success: z.literal(true), deleted: z.boolean() }) } } } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const deleted = await deleteNote(db(c), this.getUserId(c), params.id, new Date().toISOString());
		noStore(c);
		return c.json({ success: true as const, deleted });
	}
}

export class NotesDeleteAll extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'Delete all private notes, or one video\'s',
			request: { query: z.object({ videoId: z.string().max(64).optional() }) },
			responses: { '200': { description: 'How many notes were deleted', content: { 'application/json': { schema: z.object({ success: z.literal(true), deleted: z.number().int() }) } } } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const deleted = await deleteAllNotes(db(c), userId, new Date().toISOString(), query.videoId);
		logger.debug('[Notes] Deleted all', { userId, videoId: query.videoId, deleted });
		noStore(c);
		return c.json({ success: true as const, deleted });
	}
}

export class NotesExport extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Library'],
			summary: 'Export private notes as Markdown',
			description: 'Video titles, links, timestamps with seek links and note text. Generated on demand and never stored. `lang=ar` writes the headings in Arabic.',
			request: { query: z.object({ videoId: z.string().max(64).optional(), lang: z.enum(['en', 'ar']).optional() }) },
			responses: { '200': { description: 'text/markdown attachment' } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const notes = await exportNotes(db(c), userId, EXPORT_MAX, query.videoId);
		const videos = new Map<string, ExportVideo | null>();
		const ids = [...new Set(notes.map((n) => n.videoId))];
		await Promise.all(
			ids.slice(0, EXPORT_VIDEO_READS).map(async (id) => {
				const video = await loadVideoRecord<{ title?: string; titleLocalized?: Record<string, string> }>(c.env as never, id);
				const access = await videoReadAccess(c.env, video as never, userId);
				const title = access && video ? (query.lang === 'ar' ? video.titleLocalized?.ar : video.titleLocalized?.en) || video.title || null : null;
				videos.set(id, access ? { id, title } : null);
			}),
		);
		const ar = query.lang === 'ar';
		const markdown = notesMarkdown(notes, videos, webOrigin(c.env as never), ar ? 'ملاحظاتي في الأمة الآن' : 'My notes on Al Ummah Now', ar ? 'مرئي غير متاح' : 'Unavailable video', ar ? 'ar' : 'en');
		return c.body(markdown, 200, {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Content-Disposition': `attachment; filename="al-ummah-now-notes-${new Date().toISOString().slice(0, 10)}.md"`,
			'Cache-Control': 'private, no-store',
		});
	}
}
