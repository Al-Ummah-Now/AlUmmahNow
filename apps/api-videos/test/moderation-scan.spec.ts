/**
 * Epic 28: api-videos sends one ModerationScan per content write to the moderation queue,
 * in the background, and a failing send never fails the request.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, MODERATION_MAX_TEXT } from '@al-ummah/shared-types';
import { buildScanMessage, communityPostScanText, toScanText, videoScanText } from '../src/lib/moderation-scan';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('scan text helpers', () => {
	it('strips tags and entities, collapses whitespace and caps the length', () => {
		assert.equal(toScanText('<p>Salam&nbsp;<b>all</b> &amp; welcome</p>'), 'Salam all & welcome');
		assert.equal(toScanText('x'.repeat(MODERATION_MAX_TEXT + 50)).length, MODERATION_MAX_TEXT);
		assert.equal(toScanText(null), '');
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
		assert.equal(buildScanMessage({ surface: 'video_comment', event: 'create', subjectId: 'c', text: '  <br/> ' }), null);
		const m = buildScanMessage({ surface: 'video_comment', event: 'create', subjectId: 'c', text: 'hi' })!;
		assert.equal(m.type, MessageType.ModerationScan);
		assert.equal(m.payload.text, 'hi');
	});
});

describe('comment endpoints send ModerationScan', () => {
	function routes(r: any) {
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
