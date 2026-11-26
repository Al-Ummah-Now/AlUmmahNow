/**
 * Caption drafts (AUN-CAPTIONS §3.3): save over the loaded version, publish to the track, and the
 * Quran rule: the published track holds references only; the official text comes from our Quran
 * Foundation copy when the track is served, and only for spans the creator accepted. Fixture data.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY, captionDraftKey, quranTextKey, type CaptionDraft } from '@al-ummah/shared-types';
import { CaptionDraftDelete, CaptionDraftDownload, CaptionDraftGet, CaptionDraftPublish, CaptionDraftSave, CaptionDraftsList } from '../src/endpoints/captions/captionDrafts';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { SubtitlesGet } from '../src/endpoints/video/subtitlesGet';
import { SubtitlesDownload } from '../src/endpoints/video/subtitlesDownload';
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

function env(opts: { copy?: boolean; track?: 'upload'; viewerDownload?: boolean } = {}) {
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
	// The admin's caption settings: viewer downloads are off unless a test turns them on
	const global_settings = new MemoryBucket(opts.viewerDownload ? { 'captions/settings.json': { viewerDownload: { enabled: true } } } : {});
	const channels = new MemoryBucket({ 'owner-ch': { id: 'owner-ch', userId: 'owner', members: [{ userId: 'ed', role: 'editor' }, { userId: 'mod', role: 'moderator' }] } });
	return { subtitles, MEDIA_PRIVATE, videos: new MemoryBucket({ v1: videoFixture() }), channels, global_settings, queue: new MemoryQueue(), Audience: 'https://api.test' };
}

const app = (userId = 'owner', roles?: string[]) =>
	buildApp((r) => {
		r.get('/api/videos/:id', VideoFetch);
		r.get('/api/videos/:videoId/captions/drafts', CaptionDraftsList);
		r.get('/api/videos/:videoId/captions/drafts/:language', CaptionDraftGet);
		r.put('/api/videos/:videoId/captions/drafts/:language', CaptionDraftSave);
		r.delete('/api/videos/:videoId/captions/drafts/:language', CaptionDraftDelete);
		r.post('/api/videos/:videoId/captions/drafts/:language/publish', CaptionDraftPublish);
		r.get('/api/videos/:videoId/captions/drafts/:language/download', CaptionDraftDownload);
		r.get('/api/videos/:videoId/subtitles/:language', SubtitlesGet);
		r.get('/api/videos/:videoId/subtitles/:language/download', SubtitlesDownload);
	}, userId ? { userId, roles } : null);
const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => clearQuranCopyCache());

describe('caption drafts', () => {
	it('reports Quran Foundation only for published captions containing Quran text', async () => {
		const e = env();
		const router = app();
		const watch = async () => {
			const response = await router.request('/api/videos/v1', {}, e as never);
			assert.equal(response.status, 200);
			return await response.json() as { captionSources?: string[] };
		};
		const publish = async () => {
			const response = await router.request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 1 }), e as never);
			assert.equal(response.status, 200);
		};
		assert.equal((await watch()).captionSources, undefined);
		const source = draft();
		const verse = source.cues[1].segments[0];
		assert.equal(verse.type, 'quran');
		source.cues[1].segments[0] = { ...verse, status: 'accepted' };
		e.subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify(source));
		await publish();
		assert.deepEqual((await watch()).captionSources, ['quranFoundation']);
		const original = draft();
		e.subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify(draft({ cues: [original.cues[2]] })));
		await publish();
		assert.equal((await watch()).captionSources, undefined);
	});

	it('lists and reads a draft for the owner; nobody else', async () => {
		const e = env();
		const list = (await (await app().request('/api/videos/v1/captions/drafts', {}, e as never)).json()) as any;
		assert.deepEqual(list.data.drafts.map((d: any) => [d.language, d.version, d.pendingQuran, d.track]), [['ar', 1, 2, 'none']]);
		const one = (await (await app().request('/api/videos/v1/captions/drafts/ar', {}, e as never)).json()) as any;
		assert.equal(one.data.cues.length, 3);
		assert.equal((await app('stranger').request('/api/videos/v1/captions/drafts/ar', {}, e as never)).status, 403);
		assert.equal((await app().request('/api/videos/v1/captions/drafts/en', {}, e as never)).status, 404);
		assert.equal(one.data.quranEdition, null, 'the Arabic draft shows the Arabic text, no translation');
	});

	it('a translated draft with Quran names the translation its viewers see there', async () => {
		const e = env();
		e.subtitles.store.set(captionDraftKey('v1', 'en'), JSON.stringify(draft({ language: 'en', kind: 'translation', sourceLanguage: 'ar', sourceVersion: 1 })));
		const en = (await (await app().request('/api/videos/v1/captions/drafts/en', {}, e as never)).json()) as any;
		assert.deepEqual(en.data.quranEdition, { name: 'Saheeh International' }, 'the shipped default when neither the channel nor the site picked one');
		const speechOnly = draft({ language: 'en', kind: 'translation', cues: [{ id: 'c1', startMs: 0, endMs: 1000, segments: [{ type: 'speech', text: 'hi' }] }] });
		e.subtitles.store.set(captionDraftKey('v1', 'en'), JSON.stringify(speechOnly));
		const plain = (await (await app().request('/api/videos/v1/captions/drafts/en', {}, e as never)).json()) as any;
		assert.equal(plain.data.quranEdition, null);
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
		// QF (2026-11-23): the cue with Quran text ends with QF's short credit (right to left), once;
		// the reference-only cue has none
		const blocks = vtt.split(/\n{2,}/);
		const quranCue = blocks.find((b) => b.includes('﴿'))!;
		assert.equal(quranCue.split('\n').at(-1), '\u200fالمصدر: مؤسسة القرآن');
		assert.equal(vtt.split('المصدر: مؤسسة القرآن').length - 1, 1);
		assert.ok(!vtt.includes('بيانات القرآن مقدَّمة'), 'the full line belongs on the Credits page and in downloads, not in a cue');
		assert.ok(!blocks.find((b) => b.includes('quran.com/112/2'))!.includes('مؤسسة القرآن'));
		assert.match(vtt, /\[القرآن ١١٢:٢، quran\.com\/112\/2\]/, 'an unconfirmed suggestion is a reference only');
		assert.ok(!vtt.includes('ٱلصَّمَدُ'), 'the suggestion has no Quran text');
		assert.ok(!vtt.includes(HEARD));
		assert.ok(!/[]/.test(vtt));
		assert.match(served.headers.get('etag')!, new RegExp(`-${VERSION}"$`));
		const again = await app().request('/api/videos/v1/subtitles/ar', { headers: { 'If-None-Match': served.headers.get('etag')! } }, e as never);
		assert.equal(again.status, 304);
		const disabled = await app().request('/api/videos/v1/subtitles/ar', {
			headers: { 'If-None-Match': served.headers.get('etag')! },
		}, { ...e, FEATURES_FORCE_OFF: 'playerCredits' } as never);
		assert.equal(disabled.status, 200);
		const references = await disabled.text();
		assert.match(references, /quran\.com\/112\/1/);
		assert.doesNotMatch(references, /﴿|مؤسسة القرآن/);
	});

	it('a viewer downloads the track: verse text filled at download time, attribution and edition inside, nothing stored', async () => {
		const e = env({ viewerDownload: true });
		const accepted = draft().cues.map((c) => (c.id === 'c2' ? { ...c, segments: [{ ...(c.segments[0] as any), status: 'accepted' }] } : c));
		await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: accepted }), e as never);
		await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 2 }), e as never);
		const keys = [...e.subtitles.store.keys()].sort();
		const served = await (await app('').request('/api/videos/v1/subtitles/ar', {}, e as never)).text();

		const vtt = await app('').request('/api/videos/v1/subtitles/ar/download', {}, e as never);
		assert.equal(vtt.status, 200);
		assert.equal(vtt.headers.get('content-type'), 'text/vtt; charset=utf-8');
		assert.equal(vtt.headers.get('content-disposition'), 'attachment; filename="v1-ar.vtt"');
		assert.equal(vtt.headers.get('cache-control'), 'no-store');
		const file = await vtt.text();
		assert.match(file, /^WEBVTT\n\nNOTE\nQuran data provided by Quran Foundation \(https:\/\/quran\.foundation\/\)\nبيانات القرآن مقدَّمة من مؤسسة القرآن \(https:\/\/quran\.foundation\/\u200e\)\nQuran text: Uthmani \(Hafs\)\nنص القرآن: الرسم العثماني \(حفص\)\n\n/);
		// The verse text exactly as served for viewing: unaltered
		assert.equal(file.replace(/\n\nNOTE\n[^]*?\n\n/, '\n\n'), served.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
		assert.match(file, /قُلْ هُوَ ٱللَّهُ أَحَدٌ/);
		assert.ok(!file.includes(HEARD) && !/[\uE000\uE001]/.test(file));

		const srt = await app('').request('/api/videos/v1/subtitles/ar/download?format=srt', {}, e as never);
		assert.equal(srt.headers.get('content-type'), 'application/x-subrip; charset=utf-8');
		assert.equal(srt.headers.get('content-disposition'), 'attachment; filename="v1-ar.srt"');
		const srtFile = await srt.text();
		assert.match(srtFile, /^1\n00:00:00,000 --> 00:00:00,000\nQuran data provided by Quran Foundation \(https:\/\/quran\.foundation\/\)\n/);
		assert.match(srtFile, /\n3\n00:00:03,000 --> 00:00:06,000\n.*قُلْ هُوَ ٱللَّهُ أَحَدٌ/);

		// Built per request: the bucket holds exactly what it held before
		assert.deepEqual([...e.subtitles.store.keys()].sort(), keys);
		assert.ok(!e.subtitles.store.get('v1/ar.vtt')!.includes('قُلْ'));
		assert.equal((await app('').request('/api/videos/v1/subtitles/en/download', {}, e as never)).status, 404);
	});

	it('a track without Quran downloads as uploaded, with no attribution', async () => {
		const e = env({ viewerDownload: true });
		e.subtitles.store.set('v1/en.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.500 align:start\n<v Speaker>Hello</v> <b>there</b>\n');
		const vtt = await (await app('').request('/api/videos/v1/subtitles/en/download', {}, e as never)).text();
		assert.equal(vtt, 'WEBVTT\n\n00:00.000 --> 00:02.500 align:start\n<v Speaker>Hello</v> <b>there</b>\n');
		const srt = await (await app('').request('/api/videos/v1/subtitles/en/download?format=srt', {}, e as never)).text();
		assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,500\nHello <b>there</b>\n');
	});

	it('viewer downloads off (the default): only the owner, the channel\'s caption editors and admins get the file', async () => {
		const e = env();
		e.subtitles.store.set('v1/en.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.500\nHello\n');
		const get = (userId: string, roles?: string[], lang = 'en') => app(userId, roles).request(`/api/videos/v1/subtitles/${lang}/download`, {}, e as never);
		// Anyone else: 404 feature_off, whether or not a track exists (nothing to learn from it)
		for (const [who, roles] of [['', undefined], ['stranger', undefined], ['mod', undefined]] as const) {
			for (const lang of ['en', 'fr']) {
				const res = await get(who, roles as string[] | undefined, lang);
				assert.equal(res.status, 404, `${who || 'anonymous'} ${lang}`);
				assert.deepEqual(await res.json(), { success: false, code: 'feature_off', feature: 'viewerCaptionDownload' });
			}
		}
		// The owner, an editor on the video's channel, and an admin: the file
		for (const [who, roles] of [['owner', undefined], ['ed', undefined], ['staff', ['admin']], ['boss', ['super_admin']]] as const) {
			const res = await get(who, roles as string[] | undefined);
			assert.equal(res.status, 200, who);
			assert.equal(await res.text(), 'WEBVTT\n\n00:00.000 --> 00:02.500\nHello\n');
		}
		// Allowed, but no such track: a plain 404
		assert.equal((await get('owner', undefined, 'fr')).status, 404);
	});

	it('viewer downloads on: anyone gets the file', async () => {
		const e = env({ viewerDownload: true });
		e.subtitles.store.set('v1/en.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.500\nHello\n');
		for (const who of ['', 'stranger', 'mod']) assert.equal((await app(who).request('/api/videos/v1/subtitles/en/download', {}, e as never)).status, 200, who || 'anonymous');
	});

	it('with no fresh copy an accepted span is served as a reference', async () => {
		const e = env({ copy: false });
		const accepted = draft().cues.map((c) => (c.id === 'c2' ? { ...c, segments: [{ ...(c.segments[0] as any), status: 'accepted' }] } : c));
		await app().request('/api/videos/v1/captions/drafts/ar', json('PUT', { baseVersion: 1, cues: accepted }), e as never);
		await app().request('/api/videos/v1/captions/drafts/ar/publish', json('POST', { baseVersion: 2 }), e as never);
		const vtt = await (await app().request('/api/videos/v1/subtitles/ar', {}, e as never)).text();
		assert.match(vtt, /\[القرآن ١١٢:١، quran\.com\/112\/1\]/);
		assert.ok(!vtt.includes(HEARD));
		assert.ok(!vtt.includes('quran.foundation'), 'no Quran text shown, so no attribution');
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

describe('caption draft download (Studio, QF 2026-11-22)', () => {
	const member = (userId: string, role: string) => ({ userId, role, addedBy: 'owner', addedAt: '2026-11-01T00:00:00.000Z' });
	/** A private video of a channel with an editor and a moderator; the draft's first span accepted. */
	function privateEnv() {
		const e = env();
		const accepted = draft().cues.map((c) => (c.id === 'c2' ? { ...c, segments: [{ ...(c.segments[0] as any), status: 'accepted' }] } : c));
		e.subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify(draft({ cues: accepted, version: 3 })));
		e.videos.store.set('v1', JSON.stringify(videoFixture({ isPublic: false, visibility: 'private' })));
		const channels = new MemoryBucket({ 'owner-ch': { id: 'owner-ch', userId: 'owner', members: [member('ed', 'editor'), member('mod', 'moderator')] } });
		return { ...e, channels };
	}
	const get = (userId: string, path: string, e: unknown) => app(userId).request(path, {}, e as never);

	it('the owner downloads a private video\'s draft: accepted verse text filled, suggestion a reference, attribution inside, nothing stored', async () => {
		const e = privateEnv();
		const keys = [...e.subtitles.store.keys()].sort();
		const res = await get('owner', '/api/videos/v1/captions/drafts/ar/download', e);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('content-type'), 'text/vtt; charset=utf-8');
		assert.equal(res.headers.get('content-disposition'), 'attachment; filename="v1-ar-draft-v3.vtt"');
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const file = await res.text();
		assert.match(file, /^WEBVTT\n\nNOTE\nQuran data provided by Quran Foundation \(https:\/\/quran\.foundation\/\)\n/);
		assert.match(file, /Quran text: Uthmani \(Hafs\)\nنص القرآن: الرسم العثماني \(حفص\)\n\n/);
		// The official text exactly as our copy holds it, and only for the accepted span
		assert.match(file, /﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ \(الإخلاص ١١٢:١\)/);
		assert.match(file, /\[القرآن ١١٢:٢، quran\.com\/112\/2\]/);
		assert.ok(!file.includes('ٱلصَّمَدُ') && !file.includes(HEARD) && !/[\uE000\uE001]/.test(file));
		assert.deepEqual([...e.subtitles.store.keys()].sort(), keys);

		const srt = await get('owner', '/api/videos/v1/captions/drafts/ar/download?format=srt', e);
		assert.equal(srt.headers.get('content-type'), 'application/x-subrip; charset=utf-8');
		assert.equal(srt.headers.get('content-disposition'), 'attachment; filename="v1-ar-draft-v3.srt"');
		const srtFile = await srt.text();
		assert.match(srtFile, /^1\n00:00:00,000 --> 00:00:00,000\nQuran data provided by Quran Foundation/);
		assert.match(srtFile, /\n3\n00:00:03,000 --> 00:00:06,000\n.*قُلْ هُوَ ٱللَّهُ أَحَدٌ/);
	});

	it('a channel editor may download; a moderator, a stranger or a signed-out caller may not', async () => {
		const e = privateEnv();
		assert.equal((await get('ed', '/api/videos/v1/captions/drafts/ar/download', e)).status, 200);
		assert.equal((await get('mod', '/api/videos/v1/captions/drafts/ar/download', e)).status, 403);
		assert.equal((await get('stranger', '/api/videos/v1/captions/drafts/ar/download', e)).status, 403);
		// Signed out: the auth middleware answers 401 in the worker; here no user id is refused too
		assert.ok([401, 403].includes((await get('', '/api/videos/v1/captions/drafts/ar/download', e)).status));
	});

	it('404 for a missing draft or video, 400 for a draft with no text, a draft without Quran has no attribution', async () => {
		const e = privateEnv();
		assert.equal((await get('owner', '/api/videos/v1/captions/drafts/en/download', e)).status, 404);
		assert.equal((await get('owner', '/api/videos/v2/captions/drafts/ar/download', e)).status, 404);
		e.subtitles.store.set(captionDraftKey('v1', 'en'), JSON.stringify(draft({ language: 'en', cues: [{ id: 'c1', startMs: 0, endMs: 1000, segments: [{ type: 'speech', text: '  ' }] }] })));
		const empty = await get('owner', '/api/videos/v1/captions/drafts/en/download', e);
		assert.equal(empty.status, 400);
		assert.deepEqual(await empty.json(), { success: false, error: 'draft_empty' });
		e.subtitles.store.set(captionDraftKey('v1', 'en'), JSON.stringify(draft({ language: 'en', cues: [{ id: 'c1', startMs: 0, endMs: 2500, segments: [{ type: 'speech', text: 'Hello & welcome' }] }] })));
		assert.equal(await (await get('owner', '/api/videos/v1/captions/drafts/en/download', e)).text(), 'WEBVTT\n\nc1\n00:00:00.000 --> 00:00:02.500\nHello &amp; welcome\n');
	});
});
