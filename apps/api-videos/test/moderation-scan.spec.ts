/**
 * Epic 28: api-videos sends one ModerationScan per content write to the moderation queue,
 * in the background, and a failing send never fails the request.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, MODERATION_MAX_TEXT } from '@al-ummah/shared-types';
import { buildScanMessages, communityPostScanText, MAX_SCAN_PARTS, toScanText, videoScanText } from '../src/lib/moderation-scan';
import { CommentApprove } from '../src/endpoints/video/commentApprove';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('scan text helpers', () => {
	it('strips tags only for HTML surfaces; plain text keeps bracketed content', () => {
		assert.equal(toScanText('<p>Salam&nbsp;<b>all</b> &amp; welcome</p>', true), 'Salam all & welcome');
		assert.equal(toScanText('you are an <insult here>  ok'), 'you are an <insult here> ok');
		assert.equal(toScanText(null), '');
		const [m] = buildScanMessages({ surface: 'video_comment', event: 'create', subjectId: 'c', text: '<b>bad</b>' });
		assert.equal(m.payload.text, '<b>bad</b>');
	});

	it('splits long text into parts so nothing goes unscanned', () => {
		const text = 'a'.repeat(MODERATION_MAX_TEXT) + 'b'.repeat(MODERATION_MAX_TEXT) + 'TAIL';
		const messages = buildScanMessages({ surface: 'video_comment', event: 'create', subjectId: 'c', text });
		assert.equal(messages.length, 3);
		assert.deepEqual(messages.map((m) => [m.payload.part, m.payload.parts]), [[1, 3], [2, 3], [3, 3]]);
		assert.equal(messages[2].payload.text, 'TAIL');
		assert.equal(buildScanMessages({ surface: 'video_comment', event: 'create', subjectId: 'c', text: 'x'.repeat(MODERATION_MAX_TEXT * (MAX_SCAN_PARTS + 2)) }).length, MAX_SCAN_PARTS);
		assert.equal(buildScanMessages({ surface: 'video_comment', event: 'create', subjectId: 'c', text: 'short' })[0].payload.part, undefined);
	});

	it('joins video title, description, tags and localized variants without duplicates', () => {
		const text = videoScanText({ title: 'Tafsir', titleLocalized: { ar: 'تفسير', en: 'Tafsir' }, description: 'Part 1', tags: ['quran', 'tafsir'] });
		assert.equal(text, 'Tafsir\nتفسير\nPart 1\nquran tafsir');
	});

	it('includes poll and quiz text of community posts', () => {
		const text = communityPostScanText({ content: 'Vote', poll: { question: 'Best time?', options: [{ id: 'a', text: 'Fajr' }] } });
		assert.equal(text, 'Vote\nBest time?\nFajr');
	});

	it('builds no message for empty text', () => {
		assert.deepEqual(buildScanMessages({ surface: 'community_post', event: 'create', subjectId: 'c', text: '  <br/> ' }), []);
		const [m] = buildScanMessages({ surface: 'video_comment', event: 'create', subjectId: 'c', text: 'hi' });
		assert.equal(m.type, MessageType.ModerationScan);
		assert.equal(m.payload.text, 'hi');
	});
});

describe('comment endpoints send ModerationScan', () => {
	function routes(r: any) {
		r.post('/api/videos/:id/comments/:cid/approve', CommentApprove);
		r.post('/api/videos/:id/comments', CommentCreate);
		r.put('/api/videos/:id/comments/:cid', CommentUpdate);
	}
	function env(moderation: { send(m: unknown): Promise<unknown> } | undefined) {
		return {
			videos: new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('mine', { userId: 'viewer', text: 'old text' })] }) }),
			channels: new MemoryBucket(),
			profiles: new MemoryBucket(),
			queue: new MemoryQueue(),
			MODERATION_QUEUE: moderation,
		};
	}
	const req = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json', channelId: 'viewer-ch' }, body: JSON.stringify(body) });

	it('create and changed edit each send one scan with the subject; unchanged edit sends none', async () => {
		const moderation = new MemoryQueue();
		const e = env(moderation);
		const app = buildApp(routes, { userId: 'viewer' });

		const created = (await (await app.request('/api/videos/v1/comments', req('POST', { text: 'السلام عليكم' }), e)).json()) as any;
		await tick();
		assert.equal(moderation.messages.length, 1);
		assert.deepEqual(
			{ ...moderation.messages[0].payload, timestamp: undefined },
			{ surface: 'video_comment', event: 'create', subjectId: created.result.comment.id, parentId: 'v1', authorId: 'viewer', channelId: 'viewer-ch', text: 'السلام عليكم', timestamp: undefined },
		);

		await app.request('/api/videos/v1/comments/mine', req('PUT', { text: 'old text' }), e);
		await tick();
		assert.equal(moderation.messages.length, 1);

		await app.request('/api/videos/v1/comments/mine', req('PUT', { text: 'new text' }), e);
		await tick();
		assert.equal(moderation.messages.length, 2);
		assert.equal(moderation.messages[1].payload.event, 'edit');
		assert.equal(moderation.messages[1].payload.subjectId, 'mine');
	});

	it('a failing moderation queue does not fail the request; no binding means no scan', async () => {
		const broken = { send: async () => { throw new Error('queue down'); } };
		const res = await buildApp(routes, { userId: 'viewer' }).request('/api/videos/v1/comments', req('POST', { text: 'hello' }), env(broken));
		assert.equal(res.status, 200);
		await tick();
		const ok = await buildApp(routes, { userId: 'viewer' }).request('/api/videos/v1/comments', req('POST', { text: 'hello' }), env(undefined));
		assert.equal(ok.status, 200);
	});
});

describe('moderation holds', () => {
	it('the video owner cannot approve a comment held by moderation', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ userId: 'owner', comments: [commentFixture('c1', { status: 'held', heldBy: 'moderation' })] }) });
		const e = { videos, channels: new MemoryBucket(), profiles: new MemoryBucket(), queue: new MemoryQueue() };
		const app = buildApp((r: any) => r.post('/api/videos/:id/comments/:cid/approve', CommentApprove), { userId: 'owner' });
		const res = await app.request('/api/videos/v1/comments/c1/approve', { method: 'POST' }, e);
		assert.equal(res.status, 403);
		assert.equal(((await res.json()) as any).error, 'held_by_moderation');
	});
});
