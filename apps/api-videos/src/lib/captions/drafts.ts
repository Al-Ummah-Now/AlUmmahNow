/**
 * Caption drafts (AUN-CAPTIONS §3.3, §5.6) in the subtitles bucket: `<videoId>/drafts/<lang>.json`,
 * and a copy of each published version at `<videoId>/drafts/<lang>/v<n>.json`. Drafts are created
 * by the claim of a review transcript (#1296) and by caption jobs; the creator edits and publishes.
 * Publishing writes the track's WebVTT with a marker per Quran span, filled when it is served.
 */
import {
	captionDraftKey,
	captionDraftVersionKey,
	captionDraftsPrefix,
	fillCaptionQuranMarkers,
	hasCaptionQuranMarkers,
	parseQuranRange,
	pendingQuranSuggestions,
	quranCueText,
	renderCaptionVtt,
	type CaptionDraft,
	type SubtitleMetadata,
	type SubtitleTrack,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { SubtitleService } from '../subtitles';
import { readQuranCurrent, readQuranPassage } from '../quran/copy';
import { spanTranslation, type QfTranslationEnv } from '../quran/translations';
import { quranTranslationCueText, type QuranTranslationEdition } from '@al-ummah/shared-types';

type Bucket = any;

export interface CaptionDraftSummary {
	language: string;
	version: number;
	kind: CaptionDraft['kind'];
	origin: CaptionDraft['origin'];
	edited: boolean;
	cues: number;
	pendingQuran: number;
	updatedAt: string;
	/** A machine translation: the draft and version it was made from */
	sourceLanguage?: string;
	sourceVersion?: number;
	/** Translated from the source language's published track (TA-20) */
	sourceTrack?: 'published';
	publishedVersion?: number;
	publishedAt?: string;
	/** A track of this language is live, and whether it is this draft's (not an upload) */
	track: 'none' | 'machine' | 'upload';
}

export function summariseDraft(draft: CaptionDraft, track: SubtitleTrack | undefined): CaptionDraftSummary {
	return {
		language: draft.language,
		version: draft.version,
		kind: draft.kind,
		origin: draft.origin,
		edited: draft.edited,
		cues: draft.cues.length,
		pendingQuran: pendingQuranSuggestions(draft.cues),
		updatedAt: draft.updatedAt,
		...(draft.kind === 'translation' && draft.sourceLanguage
			? { sourceLanguage: draft.sourceLanguage, ...(draft.sourceVersion ? { sourceVersion: draft.sourceVersion } : {}), ...(draft.sourceTrack === 'published' ? { sourceTrack: 'published' as const } : {}) }
			: {}),
		...(draft.publishedVersion ? { publishedVersion: draft.publishedVersion, publishedAt: draft.publishedAt } : {}),
		track: trackKind(track),
	};
}

export const trackKind = (track: SubtitleTrack | undefined): CaptionDraftSummary['track'] =>
	!track ? 'none' : track.origin === 'machine' || track.origin === 'machine_edited' ? 'machine' : 'upload';

export async function readDraft(bucket: Bucket, videoId: string, language: string): Promise<CaptionDraft | null> {
	const obj = await bucket.get(captionDraftKey(videoId, language));
	return obj ? ((await obj.json()) as CaptionDraft) : null;
}

export async function readTracks(bucket: Bucket, videoId: string): Promise<SubtitleTrack[]> {
	const obj = await bucket.get(`${videoId}/metadata.json`);
	return obj ? (((await obj.json()) as SubtitleMetadata).tracks ?? []) : [];
}

/** Every draft of a video (one per language). */
export async function listDrafts(bucket: Bucket, videoId: string): Promise<CaptionDraft[]> {
	const prefix = captionDraftsPrefix(videoId);
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects) if (/^[^/]+\.json$/.test(o.key.slice(prefix.length))) keys.push(o.key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	const drafts = await Promise.all(keys.map(async (k) => ((await bucket.get(k)) as { json(): Promise<CaptionDraft> } | null)?.json()));
	return drafts.filter((d): d is CaptionDraft => !!d).sort((a, b) => a.language.localeCompare(b.language));
}

/** Deletes a draft and its published copies; the live track stays. */
export async function deleteDraft(bucket: Bucket, videoId: string, language: string): Promise<void> {
	const keys = [captionDraftKey(videoId, language)];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `${captionDraftsPrefix(videoId)}${language}/`, cursor, limit: 1000 });
		keys.push(...page.objects.map((o: { key: string }) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	await bucket.delete(keys);
}

export type SaveOutcome = { status: 'ok'; draft: CaptionDraft } | { status: 'missing' } | { status: 'conflict'; version: number };

/** Saves edited cues over `baseVersion` (the version the editor loaded): a newer save wins nothing silently. */
export async function saveDraftCues(bucket: Bucket, videoId: string, language: string, baseVersion: number, cues: CaptionDraft['cues'], userId: string): Promise<SaveOutcome> {
	const repo = new R2Repository<CaptionDraft>(bucket);
	const { data, rejected } = await repo.updateObjectOrReject<number>(captionDraftKey(videoId, language), (draft) => {
		if (draft.version !== baseVersion) return { reject: draft.version };
		const changed = JSON.stringify(draft.cues) !== JSON.stringify(cues);
		if (!changed) return false;
		draft.cues = cues;
		draft.edited = true;
		draft.version += 1;
		draft.updatedAt = new Date().toISOString();
		draft.updatedBy = userId;
		return true;
	});
	if (!data) return { status: 'missing' };
	if (rejected !== undefined) return { status: 'conflict', version: rejected };
	return { status: 'ok', draft: data };
}

export type PublishOutcome =
	| { status: 'ok'; draft: CaptionDraft; track: SubtitleTrack; tracks: SubtitleTrack[] }
	| { status: 'missing' }
	| { status: 'conflict'; version: number }
	| { status: 'empty' }
	| { status: 'replaces_upload' };

/**
 * Publishes the draft version the creator is looking at: the track's WebVTT (Quran as markers),
 * a copy of that version, and the track in the subtitle metadata. A track the creator uploaded
 * in the same language is replaced only when they said so.
 */
export async function publishDraft(
	bucket: Bucket,
	opts: { videoId: string; language: string; baseVersion: number; userId: string; replaceUpload: boolean; apiBaseUrl: string },
): Promise<PublishOutcome> {
	const { videoId, language, baseVersion, userId } = opts;
	const draft = await readDraft(bucket, videoId, language);
	if (!draft) return { status: 'missing' };
	if (draft.version !== baseVersion) return { status: 'conflict', version: draft.version };
	const tracks = await readTracks(bucket, videoId);
	const existing = tracks.find((t) => t.language === language);
	if (existing && trackKind(existing) === 'upload' && !opts.replaceUpload) return { status: 'replaces_upload' };

	const vtt = renderCaptionVtt(draft);
	// A WebVTT cue timing line, so a draft whose cues all rendered empty is not published
	if (!vtt.includes(' --> ')) return { status: 'empty' };
	await bucket.put(`${videoId}/${language}.vtt`, vtt, {
		httpMetadata: { contentType: 'text/vtt' },
		customMetadata: hasCaptionQuranMarkers(vtt) ? { quran: '1', ...(draft.kind === 'translation' ? { qtr: '1' } : {}) } : {},
	});
	await bucket.put(captionDraftVersionKey(videoId, language, draft.version), JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' } });

	const service = new SubtitleService();
	const now = new Date().toISOString();
	const track: SubtitleTrack = {
		id: crypto.randomUUID(),
		language,
		label: existing?.label ?? service.getLanguageLabel(language),
		kind: 'subtitles',
		isDefault: existing?.isDefault ?? false,
		isAutoGenerated: true,
		origin: draft.edited ? 'machine_edited' : 'machine',
		...(draft.kind === 'translation' ? { machineTranslation: true, sourceLanguage: draft.sourceLanguage } : {}),
		version: draft.version,
		uploadedBy: userId,
		uploadedAt: now,
		fileSize: new TextEncoder().encode(vtt).length,
		format: 'vtt',
		url: `${opts.apiBaseUrl}/api/videos/${videoId}/subtitles/${language}`,
		status: 'ready',
	};
	const metadata = await new R2Repository<SubtitleMetadata>(bucket).updateObject(
		`${videoId}/metadata.json`,
		(current) => {
			Object.assign(current, service.addTrack(current, track));
		},
		{ initial: () => service.createMetadata(videoId, []) },
	);
	// Record what was published (a save that landed meanwhile keeps its own version)
	const marked = await new R2Repository<CaptionDraft>(bucket).updateObject(captionDraftKey(videoId, language), (d) => {
		if (d.version !== draft.version) return false;
		d.publishedVersion = draft.version;
		d.publishedAt = now;
		return true;
	});
	return { status: 'ok', draft: marked ?? { ...draft, publishedVersion: draft.version, publishedAt: now }, track, tracks: metadata?.tracks ?? [track] };
}

/** The copy version a served track's Quran text comes from ('none' with no fresh copy): part of its ETag. */
export async function quranCopyTag(mediaPrivate: Bucket | undefined): Promise<string> {
	return (await readQuranCurrent(mediaPrivate).catch(() => null))?.version ?? 'none';
}

/**
 * Fills a published track's Quran markers from our copy; references where there is no text. A
 * translated track's spans show the official translation of `edition` fetched live from Quran
 * Foundation (never machine translation): with no edition for the language, the Arabic text; QF
 * unreachable, the reference with a quran.com link.
 */
/** Quran Foundation ayat one served translated track may fetch. */
export const QF_AYAT_PER_TRACK = 120;

export async function fillServedTrack(
	vtt: string,
	language: string,
	mediaPrivate: Bucket | undefined,
	translation?: { env: QfTranslationEnv; edition: QuranTranslationEdition | null; fetchImpl?: typeof fetch },
): Promise<string> {
	const arabic = async (range: string) => {
		const r = parseQuranRange(range);
		if (!r) return null;
		const passage = await readQuranPassage(mediaPrivate, r);
		if (passage.status !== 'ok') return null;
		const ok = passage as Extract<typeof passage, { status: 'ok' }>;
		const name = language.startsWith('ar') ? ok.file.name.ar : ok.file.name.simple;
		return quranCueText(ok.ayat.map((a) => a.text).join(' '), name, range, language);
	};
	// One served track asks Quran Foundation for at most QF_AYAT_PER_TRACK ayat (edge-cached); spans past
	// that show their reference and quran.com link, like a QF outage
	let ayatLeft = QF_AYAT_PER_TRACK;
	const translated = translation
		? async (range: string) => {
				if (!translation.edition) return arabic(range);
				const r = parseQuranRange(range);
				if (!r) return null;
				const ayat = r.to.surah === r.from.surah ? r.to.ayah - r.from.ayah + 1 : Infinity;
				if (ayat > ayatLeft) return null;
				ayatLeft -= ayat;
				const text = await spanTranslation(translation.env, translation.edition.id, r.from.surah, r.from.ayah, r.to.ayah, translation.fetchImpl);
				if (!text) return null;
				const passage = await readQuranPassage(mediaPrivate, r).catch(() => null);
				const name = passage && passage.status === 'ok' ? (passage as Extract<typeof passage, { status: 'ok' }>).file.name.simple : `Surah ${r.from.surah}`;
				return quranTranslationCueText(text, translation.edition.name, name, range);
			}
		: undefined;
	return fillCaptionQuranMarkers(vtt, language, arabic, translated);
}
