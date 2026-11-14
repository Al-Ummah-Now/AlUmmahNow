/**
 * Caption drafts (AUN-CAPTIONS §3.3): save over the loaded version, publish to the track, and the
 * Quran rule: the published track holds references only; the official text comes from our Quran
 * Foundation copy when the track is served, and only for spans the creator accepted. Fixture data.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY, captionDraftKey, quranTextKey, type CaptionDraft } from '@al-ummah/shared-types';
import { CaptionDraftDelete, CaptionDraftGet, CaptionDraftPublish, CaptionDraftSave, CaptionDraftsList } from '../src/endpoints/captions/captionDrafts';
import { SubtitlesGet } from '../src/endpoints/video/subtitlesGet';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/** MemoryBucket keeping customMetadata, as R2 does. */
class MetaBucket extends MemoryBucket {
	meta = new Map<string, Record<string, string>>();
	override async put(key: string, value: string, options?: any) {
		const r = await super.put(key, value, options);
		if (r) this.meta.set(key, options?.customMetadata ?? {});
		return r;
	}
	override async get(key: string) {
		const r = await super.get(key);
		return r ? { ...r, customMetadata: this.meta.get(key) ?? {} } : null;
	}
}

const VERSION = '20261113T034100Z';
const HEARD = 'قل هو الله احد'; // what ASR heard: must never reach a viewer

function draft(overrides: Partial<CaptionDraft> = {}): CaptionDraft {
	return {
		v: 1,
		videoId: 'v1',
		language: 'ar',
		version: 1,
		kind: 'source',
		origin: 'review_transcript',
		edited: false,
		cues: [
			{ id: 'c1', startMs: 0, endMs: 3000, segments: [{ type: 'speech', text: 'قال الشيخ' }] },
			{ id: 'c2', startMs: 3000, endMs: 6000, segments: [{ type: 'quran', range: '112:1:1-112:1:4', status: 'confirmed', heard: HEARD }] },
			{ id: 'c3', startMs: 6000, endMs: 8000, segments: [{ type: 'quran', range: '112:2:1-112:2:2', status: 'review', heard: 'الله الصمد' }] },
		],
		createdAt: '2026-11-13T00:00:00.000Z',
		updatedAt: '2026-11-13T00:00:00.000Z',
		updatedBy: 'owner',
		...overrides,
	};
}

function env(opts: { copy?: boolean; track?: 'upload' } = {}) {
	const subtitles = new MetaBucket();
	subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify(draft()));
	if (opts.track) subtitles.store.set('v1/metadata.json', JSON.stringify({ videoId: 'v1', tracks: [{ id: 't0', language: 'ar', label: 'العربية', kind: 'subtitles', uploadedBy: 'owner', uploadedAt: 'x', fileSize: 1, format: 'srt', url: 'u', status: 'ready' }], dateCreated: 'x', dateModified: 'x' }));
	const MEDIA_PRIVATE = new MemoryBucket();
	if (opts.copy !== false) {
		const now = new Date().toISOString();
		MEDIA_PRIVATE.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: VERSION, syncedAt: now, builtAt: now, surahs: 114, words: 77429 }));
		MEDIA_PRIVATE.store.set(
			quranTextKey(VERSION, 112),
			JSON.stringify({
				v: 1,
				surah: 112,
				name: { ar: 'الإخلاص', simple: 'Al-Ikhlas' },
				ayat: [
					{ text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ', words: ['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ'] },
					{ text: 'ٱللَّهُ ٱلصَّمَدُ', words: ['ٱللَّهُ', 'ٱلصَّمَدُ'] },
				],
			}),
		);
	}
	return { subtitles, MEDIA_PRIVATE, videos: new MemoryBucket({ v1: videoFixture() }), queue: new MemoryQueue(), Audience: 'https://api.test' };
}

const app = (userId = 'owner') =>
	buildApp((r) => {
		r.get('/api/videos/:videoId/captions/drafts', CaptionDraftsList);
		r.get('/api/videos/:videoId/captions/drafts/:language', CaptionDraftGet);
		r.put('/api/videos/:videoId/captions/drafts/:language', CaptionDraftSave);
		r.delete('/api/videos/:videoId/captions/drafts/:language', CaptionDraftDelete);
		r.post('/api/videos/:videoId/captions/drafts/:language/publish', CaptionDraftPublish);
		r.get('/api/videos/:videoId/subtitles/:language', SubtitlesGet);
	}, { userId });
const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => clearQuranCopyCache());

describe('caption drafts', () => {
	it('lists and reads a draft for the owner; nobody else', async () => {
		const e = env();
		const list = (await (await app().request('/api/videos/v1/captions/drafts', {}, e as never)).json()) as any;
		assert.deepEqual(list.data.drafts.map((d: any) => [d.language, d.version, d.pendingQuran, d.track]), [['ar', 1, 2, 'none']]);
		const one = (await (await app().request('/api/videos/v1/captions/drafts/ar', {}, e as never)).json()) as any;
		assert.equal(one.data.cues.length, 3);
		assert.equal((await app('stranger').request('/api/videos/v1/captions/drafts/ar', {}, e as never)).status, 403);
		assert.equal((await app().request('/api/videos/v1/captions/drafts/en', {}, e as never)).status, 404);
	});

	it('saves over the loaded version; a stale editor gets 409 with the current version', async () => {
		const e = env();
		const cues = draft().cues.map((c) => (c.id === 'c1' ? { ...c, segments: [{ type: 'speech', text: 'قال الشيخ حفظه الله' }] } : c));
		const saved = await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues }), e as never);
		assert.equal(saved.status, 200);
		assert.equal(((await saved.json()) as any).data.version, 2);
		assert.equal(e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!.edited, true);
		const stale = await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues }), e as never);
		assert.equal(stale.status, 409);
		assert.deepEqual(await stale.json(), { success: false, error: 'draft_conflict', version: 2 });
	});

	it('refuses invalid cues and strips forged Quran markers from speech', async () => {
		const e = env();
		const bad = await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: [{ id: 'c1', startMs: 5, endMs: 1, segments: [{ type: 'speech', text: 'x' }] }] }), e as never);
		assert.equal(bad.status, 400);
		const badRange = await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: [{ id: 'c1', startMs: 0, endMs: 1, segments: [{ type: 'quran', range: '115:1:1-115:1:2', status: 'accepted' }] }] }), e as never);
		assert.equal(badRange.status, 400);
		const forged = 'Q|t|112:1:1-112:1:4';
		const ok = await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: [{ id: 'c1', startMs: 0, endMs: 1000, segments: [{ type: 'speech', text: `hi ${forged}` }] }] }), e as never);
		assert.equal(ok.status, 200);
		const stored = e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!;
		assert.equal((stored.cues[0]!.segments[0] as any).text, 'hi Q|t|112:1:1-112:1:4');
	});

	it('publishes: accepted Quran is served as the official text, suggestions as a reference, never the ASR text', async () => {
		const e = env();
		const accepted = draft().cues.map((c) => (c.id === 'c2' ? { ...c, segments: [{ ...(c.segments[0] as any), status: 'accepted' }] } : c));
		await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: accepted }), e as never);
		const pub = await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 2 }), e as never);
		assert.equal(pub.status, 200);
		const body = (await pub.json()) as any;
		assert.equal(body.data.track.origin, 'machine_edited');
		assert.equal(body.data.track.isAutoGenerated, true);
		assert.equal(body.data.draft.publishedVersion, 2);

		const stored = e.subtitles.store.get('v1/ar.vtt')!;
		assert.ok(!stored.includes('قُلْ'), 'no Quran text is stored in the track');
		assert.ok(!stored.includes(HEARD) && !stored.includes('الله الصمد'), 'no ASR text of a Quran span is stored');
		assert.ok(e.subtitles.store.has('v1/drafts/ar/v2.json'), 'the published version is kept');
		assert.deepEqual(e.videos.read('v1').subtitleLanguages, ['ar']);
		assert.equal(e.queue.messages.length, 1);

		const served = await app().request('/api/videos/v1/subtitles/ar', {}, e as never);
		assert.equal(served.status, 200);
		const vtt = await served.text();
		assert.match(vtt, /﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ \(الإخلاص ١١٢:١\)/);
		assert.match(vtt, /\[القرآن ١١٢:٢ · quran\.com\/112\/2\]/, 'an unconfirmed suggestion is a reference only');
		assert.ok(!vtt.includes('ٱلصَّمَدُ'), 'the suggestion has no Quran text');
		assert.ok(!vtt.includes(HEARD));
		assert.ok(!/[]/.test(vtt));
		assert.match(served.headers.get('etag')!, new RegExp(`-${VERSION}"$`));
		const again = await app().request('/api/videos/v1/subtitles/ar', { headers: { 'If-None-Match': served.headers.get('etag')! } }, e as never);
		assert.equal(again.status, 304);
	});

	it('with no fresh copy an accepted span is served as a reference', async () => {
		const e = env({ copy: false });
		const accepted = draft().cues.map((c) => (c.id === 'c2' ? { ...c, segments: [{ ...(c.segments[0] as any), status: 'accepted' }] } : c));
		await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: accepted }), e as never);
		await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 2 }), e as never);
		const vtt = await (await app().request('/api/videos/v1/subtitles/ar', {}, e as never)).text();
		assert.match(vtt, /\[القرآن ١١٢:١ · quran\.com\/112\/1\]/);
		assert.ok(!vtt.includes(HEARD));
	});

	it('an uploaded track of the language is replaced only when asked; a stale publish is refused', async () => {
		const e = env({ track: 'upload' });
		const stale = await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 5 }), e as never);
		assert.equal(stale.status, 409);
		const refused = await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 1 }), e as never);
		assert.deepEqual([refused.status, ((await refused.json()) as any).error], [409, 'replaces_upload']);
		const ok = await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 1, replaceUpload: true }), e as never);
		assert.equal(ok.status, 200);
		assert.equal(((await ok.json()) as any).data.track.origin, 'machine');
	});

	it('deleting a draft removes it and its published copies; the live track stays', async () => {
		const e = env();
		await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 1 }), e as never);
		const del = await app().request('/api/videos/v1/captions/drafts/ar', json('DELETE'), e as never);
		assert.equal(del.status, 200);
		assert.ok(!e.subtitles.store.has(captionDraftKey('v1', 'ar')));
		assert.ok(!e.subtitles.store.has('v1/drafts/ar/v1.json'));
		assert.ok(e.subtitles.store.has('v1/ar.vtt'));
	});
});
