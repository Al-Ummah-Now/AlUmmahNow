/**
 * Private video notes (wiki Epic 21 §4 21.8, owner decision E21-D9): exact-time bookmarks with an
 * optional end time, listed per video in time order, last write wins, tombstones that sync, the
 * tier's note limit, Markdown export, GDPR export and erasure, and indexed reads only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NoteCreate, NoteDelete, NoteUpdate, NotesDeleteAll, NotesExport, NotesList } from '../src/endpoints/library/notes';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { arabicDigits, checkNote, escapeMarkdown, formatTimestamp, notesMarkdown, writeTime } from '../src/lib/notes';
import { collectUserData, eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

const ROUTES = (router: any) => {
	router.get('/api/library/notes', NotesList);
	router.get('/api/library/notes/export.md', NotesExport);
	router.post('/api/library/notes', NoteCreate);
	router.delete('/api/library/notes', NotesDeleteAll);
	router.put('/api/library/notes/:id', NoteUpdate);
	router.delete('/api/library/notes/:id', NoteDelete);
};

async function env(opts: { notesMax?: number | null } = {}) {
	const SEARCH_DB = new SqliteD1() as unknown as D1Database;
	if (opts.notesMax !== undefined) {
		await saveTier(SEARCH_DB, 'small', { name: 'Small', perHour: 1, perDay: 1, maxConcurrent: 1, maxChannels: 1, notesMax: opts.notesMax }, 'admin-1', { create: true });
		await assignTier(SEARCH_DB, 'u1', 'small', 'admin-1');
	}
	return {
		SEARCH_DB,
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', title: 'First [video] *one*', isPublic: true }),
			v2: videoFixture({ id: 'v2', title: 'Second', isPublic: true }),
			hidden: videoFixture({ id: 'hidden', title: 'Hidden', isPublic: false, userId: 'someone-else' }),
		}),
		VIDEOS_WEB_URL: 'https://videos.example.test',
		ENVIRONMENT: 'test',
	};
}

async function call(e: unknown, userId: string, method: string, path: string, body?: unknown) {
	const res = await buildApp(ROUTES, { userId }).request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, e as never);
	const text = await res.text();
	let parsed: any = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		// Markdown export
	}
	return { status: res.status, body: parsed, headers: res.headers };
}

describe('private video notes', () => {
	it('adds notes at exact times, lists one video in time order, and never shows them to another user', async () => {
		const e = await env();
		const late = await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 90_500, body: 'Second point' });
		assert.equal(late.status, 201);
		assert.equal(late.body.data.startMs, 90_500);
		assert.equal(late.body.data.endMs, null);
		const early = await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 12_000, endMs: 30_000, body: '  First point\r\nline two ' });
		assert.equal(early.body.data.body, 'First point\nline two');
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v2', startMs: 1, body: 'other video' });

		const list = await call(e, 'u1', 'GET', '/api/library/notes?videoId=v1');
		assert.equal(list.headers.get('cache-control'), 'private, no-store');
		assert.deepEqual(list.body.data.items.map((n: any) => n.startMs), [12_000, 90_500]);

		const paged = await call(e, 'u1', 'GET', '/api/library/notes?videoId=v1&limit=1');
		assert.equal(paged.body.data.items[0].startMs, 12_000);
		const next = await call(e, 'u1', 'GET', `/api/library/notes?videoId=v1&limit=1&cursor=${paged.body.data.nextCursor}`);
		assert.deepEqual(next.body.data.items.map((n: any) => n.startMs), [90_500]);
		assert.equal(next.body.data.nextCursor, null);

		const other = await call(e, 'u2', 'GET', '/api/library/notes?videoId=v1');
		assert.deepEqual(other.body.data.items, []);
		const steal = await call(e, 'u2', 'PUT', `/api/library/notes/${early.body.data.id}`, { startMs: 1, body: 'mine now' });
		assert.equal(steal.status, 404);
		const reuse = await call(e, 'u2', 'POST', '/api/library/notes', { id: early.body.data.id, videoId: 'v1', startMs: 1, body: 'same id' });
		assert.equal(reuse.status, 409);
		assert.equal((await call(e, 'u1', 'GET', '/api/library/notes?videoId=v1')).body.data.items[0].body, 'First point\nline two');
	});

	it('refuses bad times, long text and videos the user cannot see', async () => {
		const e = await env();
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 5000, endMs: 5000, body: 'x' })).body.error, 'invalid_time');
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 0, body: 'x'.repeat(2001) })).body.error, 'invalid_body');
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'hidden', startMs: 0, body: 'x' })).status, 404);
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'missing', startMs: 0, body: 'x' })).status, 404);
		assert.deepEqual(checkNote(1.5, null, 'x'), { error: 'invalid_time' });
	});

	it('last write wins on updatedAt; a delete is a tombstone in the sync feed', async () => {
		const e = await env();
		const made = await call(e, 'u1', 'POST', '/api/library/notes', { id: 'note-abc-1', videoId: 'v1', startMs: 1000, body: 'v1', updatedAt: '2026-11-20T10:00:00.000Z' });
		assert.equal(made.body.data.id, 'note-abc-1');
		const newer = await call(e, 'u1', 'PUT', '/api/library/notes/note-abc-1', { startMs: 2000, body: 'newer', updatedAt: '2026-11-20T12:00:00.000Z' });
		assert.equal(newer.body.applied, true);
		const older = await call(e, 'u1', 'PUT', '/api/library/notes/note-abc-1', { startMs: 3000, body: 'older edit arriving late', updatedAt: '2026-11-20T11:00:00.000Z' });
		assert.equal(older.body.applied, false);
		assert.equal(older.body.data.body, 'newer');
		assert.equal(older.body.data.startMs, 2000);
		// A retried create with the same id and an older time changes nothing
		const retried = await call(e, 'u1', 'POST', '/api/library/notes', { id: 'note-abc-1', videoId: 'v1', startMs: 1000, body: 'v1', updatedAt: '2026-11-20T10:00:00.000Z' });
		assert.equal(retried.body.data.body, 'newer');

		const removed = await call(e, 'u1', 'DELETE', '/api/library/notes/note-abc-1');
		assert.equal(removed.body.deleted, true);
		assert.equal((await call(e, 'u1', 'DELETE', '/api/library/notes/note-abc-1')).body.deleted, false);
		const feed = await call(e, 'u1', 'GET', '/api/library/notes?since=2026-11-01T00:00:00.000Z');
		assert.equal(feed.body.data.items.length, 1);
		assert.equal(feed.body.data.items[0].deleted, true);
		assert.equal(feed.body.data.items[0].body, '', 'a tombstone keeps no text');
		assert.deepEqual((await call(e, 'u1', 'GET', '/api/library/notes?videoId=v1')).body.data.items, []);
		assert.equal((await call(e, 'u1', 'PUT', '/api/library/notes/note-abc-1', { startMs: 1, body: 'revive' })).body.applied, false);
	});

	it('a client time in the future is clamped to now', () => {
		const now = Date.parse('2026-11-23T12:00:00.000Z');
		assert.equal(writeTime('2027-01-01T00:00:00.000Z', now), new Date(now).toISOString());
		assert.equal(writeTime('2026-11-23T12:03:00.000Z', now), new Date(now).toISOString());
		assert.equal(writeTime('2026-11-22T12:00:00.000Z', now), '2026-11-22T12:00:00.000Z');
		assert.equal(writeTime('not a date', now), new Date(now).toISOString());
	});

	it('stops new notes at the tier limit; deleting one frees a place', async () => {
		const e = await env({ notesMax: 2 });
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 1, body: 'a' })).status, 201);
		const second = await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 2, body: 'b' });
		const full = await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 3, body: 'c' });
		assert.equal(full.status, 409);
		assert.equal(full.body.code, 'notes_limit');
		assert.equal(full.body.limit, 2);
		await call(e, 'u1', 'DELETE', `/api/library/notes/${second.body.data.id}`);
		assert.equal((await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 3, body: 'c' })).status, 201);
	});

	it('deletes all notes or one video\'s', async () => {
		const e = await env();
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 1, body: 'a' });
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v2', startMs: 1, body: 'b' });
		await call(e, 'u2', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 1, body: 'theirs' });
		assert.equal((await call(e, 'u1', 'DELETE', '/api/library/notes?videoId=v1')).body.deleted, 1);
		assert.equal((await call(e, 'u1', 'DELETE', '/api/library/notes')).body.deleted, 1);
		assert.deepEqual((await call(e, 'u1', 'GET', '/api/library/notes')).body.data.items, []);
		assert.equal((await call(e, 'u2', 'GET', '/api/library/notes')).body.data.items.length, 1);
	});

	it('exports Markdown with titles, seek links and escaped text; Arabic uses Arabic digits for times', async () => {
		const e = await env();
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 3_725_000, body: 'Later *point*' });
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 65_000, endMs: 70_000, body: '# not a heading' });
		const en = await call(e, 'u1', 'GET', '/api/library/notes/export.md');
		assert.equal(en.status, 200);
		assert.match(en.headers.get('content-type') ?? '', /text\/markdown/);
		assert.match(en.headers.get('content-disposition') ?? '', /attachment; filename="al-ummah-now-notes-/);
		const md = en.body as string;
		assert.match(md, /## \[First \\\[video\\\] \\\*one\\\*\]\(https:\/\/videos\.example\.test\/video\/v1\)/);
		assert.ok(md.indexOf('1:05') < md.indexOf('1:02:05'), 'notes in time order');
		assert.match(md, /- \[1:05–1:10\]\(https:\/\/videos\.example\.test\/video\/v1\?t=65\) \\# not a heading/);
		assert.match(md, /- \[1:02:05\]\(https:\/\/videos\.example\.test\/video\/v1\?t=3725\) Later \\\*point\\\*/);
		const ar = (await call(e, 'u1', 'GET', '/api/library/notes/export.md?lang=ar')).body as string;
		assert.match(ar, /\[١:٠٥–١:١٠\]\(https:\/\/videos\.example\.test\/video\/v1\?t=65\)/);
	});

	it('an export lists notes on a video the user can no longer see without its title', () => {
		const md = notesMarkdown(
			[{ id: 'n', videoId: 'gone', startMs: 5000, endMs: null, body: 'kept', createdAt: 'x', updatedAt: 'x', deleted: false }],
			new Map([['gone', null]]),
			'https://videos.example.test/',
		);
		assert.match(md, /## Unavailable video/);
		assert.match(md, /- 0:05 kept/);
		assert.equal(formatTimestamp(3_600_000), '1:00:00');
		assert.equal(arabicDigits('12:05'), '١٢:٠٥');
		assert.equal(escapeMarkdown('a_b'), 'a\\_b');
	});

	it('every query reads an index, never the whole table', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const plans = [
			['SELECT id FROM video_notes WHERE user_id = ? AND video_id = ? AND (start_ms > ? OR (start_ms = ? AND id > ?)) AND deleted_at IS NULL ORDER BY start_ms, id LIMIT ?', ['u', 'v', -1, -1, '', 10]],
			['SELECT id FROM video_notes WHERE user_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at, id LIMIT ?', ['u', '', '', '', 10]],
			['SELECT id FROM video_notes WHERE user_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?', ['u', 'z', 'z', 'z', 10]],
			['SELECT COUNT(*) AS n FROM (SELECT 1 FROM video_notes WHERE user_id = ? AND deleted_at IS NULL LIMIT ?)', ['u', 10]],
		] as const;
		for (const [sql, params] of plans) {
			const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
			const detail = (results ?? []).map((r) => r.detail).join(' | ');
			assert.match(detail, /USING (COVERING )?INDEX idx_video_notes_user_/, sql);
			assert.doesNotMatch(detail, /SCAN video_notes(?! USING)/, sql);
		}
	});

	it('are in the GDPR export and erased with the account', async () => {
		const e = await env();
		await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 7000, body: 'mine' });
		const gone = await call(e, 'u1', 'POST', '/api/library/notes', { videoId: 'v2', startMs: 1, body: 'deleted one' });
		await call(e, 'u1', 'DELETE', `/api/library/notes/${gone.body.data.id}`);
		await call(e, 'u2', 'POST', '/api/library/notes', { videoId: 'v1', startMs: 1, body: 'theirs' });

		// Every store the export and erasure walk, empty apart from the notes (privacy.spec.ts covers the rest)
		const stores = { profiles: new MemoryBucket(), channels: new MemoryBucket(), channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), watch_history: new MemoryBucket(), community_posts: new MemoryBucket(), playlists: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket(), subtitles: new MemoryBucket() };
		const full = { ...stores, ...e };
		const exported = await collectUserData(full as never, 'u1', new OperationBudget(1000));
		assert.deepEqual(exported.videoNotes.map((n: any) => [n.videoId, n.startMs, n.text]), [['v1', 7000, 'mine']]);

		await eraseUserData(full as never, 'u1', new OperationBudget(10_000));
		const left = await e.SEARCH_DB.prepare('SELECT user_id FROM video_notes').all<{ user_id: string }>();
		assert.deepEqual((left.results ?? []).map((r) => r.user_id), ['u2']);
	});
});
