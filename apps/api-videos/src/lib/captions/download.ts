/**
 * Subtitle file downloads (AUN-CAPTIONS, QF 2026-11-22): a viewer may download one video's subtitle
 * file with the Quran verse text filled at download time, unaltered, and Quran Foundation's
 * attribution plus the edition inside the file. The filled file is built per request and never
 * stored (the stored track keeps references only).
 */
import { QF_ATTRIBUTION, type QuranTranslationEdition } from '@al-ummah/shared-types';

export type SubtitleDownloadFormat = 'vtt' | 'srt';

/** The lines naming the source: QF's attribution (en and ar) and the edition the verse text is from. */
export function quranAttributionLines(edition: QuranTranslationEdition | null): string[] {
	return [QF_ATTRIBUTION.en, QF_ATTRIBUTION.ar, edition ? `Translation: ${edition.name}` : 'Quran text: Uthmani (Hafs)'];
}

/** A NOTE block right after the WEBVTT header (players ignore NOTE blocks). */
export function withVttNote(vtt: string, lines: string[]): string {
	const text = vtt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
	const end = text.indexOf('\n\n');
	const header = end >= 0 ? text.slice(0, end) : text.trimEnd();
	const rest = end >= 0 ? text.slice(end + 2) : '';
	// A NOTE block may not contain "-->"; the lines here never do
	return `${header}\n\nNOTE\n${lines.join('\n')}\n\n${rest}`;
}

const srtTime = (t: string) => {
	const parts = t.trim().split(':');
	const [h, m, s] = parts.length === 3 ? parts : ['00', ...parts];
	const [sec, ms = '000'] = s!.split('.');
	return `${h!.padStart(2, '0')}:${m!.padStart(2, '0')}:${sec!.padStart(2, '0')},${ms.padEnd(3, '0').slice(0, 3)}`;
};

/**
 * WebVTT → SRT. Cue settings, NOTE/STYLE/REGION blocks and tags other than <b>, <i> and <u> are
 * dropped. `comment` lines go in a first cue of zero length (00:00:00,000 → 00:00:00,000): SRT has
 * no comment syntax, players show nothing for it, and the lines stay inside the file.
 */
export function vttToSrt(vtt: string, comment?: string[]): string {
	const blocks = vtt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
	const cues: string[] = [];
	if (comment?.length) cues.push(`00:00:00,000 --> 00:00:00,000\n${comment.join('\n')}`);
	for (const block of blocks) {
		const lines = block.split('\n').filter((l, i, all) => !(i === all.length - 1 && l === ''));
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0 || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) continue;
		const [from, rest] = lines[at]!.split('-->');
		const to = rest!.trim().split(/\s+/)[0]!;
		const text = lines
			.slice(at + 1)
			.map((l) => l.replace(/<(?!\/?[biu]>)[^>]*>/g, ''))
			.join('\n');
		cues.push(`${srtTime(from!)} --> ${srtTime(to)}\n${text}`);
	}
	return `${cues.map((c, i) => `${i + 1}\n${c}`).join('\n\n')}\n`;
}

/** The file a viewer downloads: the served track, the attribution inside it when it carries Quran text. */
export function subtitleDownload(served: string, format: SubtitleDownloadFormat, quran: { edition: QuranTranslationEdition | null } | null): string {
	const lines = quran ? quranAttributionLines(quran.edition) : undefined;
	if (format === 'srt') return vttToSrt(served, lines);
	return lines ? withVttNote(served, lines) : served;
}
