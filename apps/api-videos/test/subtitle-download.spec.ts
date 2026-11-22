/**
 * Subtitle file downloads (QF 2026-11-22): the attribution and the edition go inside the file, the
 * cues are converted to SRT without touching their text. Fixture text only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quranAttributionLines, subtitleDownload, vttToSrt, withVttNote } from '../src/lib/captions/download';

const edition = { id: 20, name: 'Saheeh International', language: 'en' };

describe('subtitle downloads', () => {
	it('names the translation edition of a translated track, the Uthmani text otherwise', () => {
		assert.deepEqual(quranAttributionLines(edition), [
			'Quran data provided by Quran Foundation (https://quran.foundation/)',
			'بيانات القرآن مقدَّمة من مؤسسة القرآن (https://quran.foundation/‎)',
			'Translation: Saheeh International',
		]);
		assert.equal(quranAttributionLines(null)[2], 'Quran text: Uthmani (Hafs)');
	});

	it('puts the NOTE after the header, BOM and CRLF normalised, header settings kept', () => {
		const vtt = '﻿WEBVTT - fixture\r\nKind: captions\r\n\r\n00:01.000 --> 00:02.000\r\n“[fixture translation 20 of 112:1]”\r\n';
		assert.equal(withVttNote(vtt, ['a', 'b']), 'WEBVTT - fixture\nKind: captions\n\nNOTE\na\nb\n\n00:01.000 --> 00:02.000\n“[fixture translation 20 of 112:1]”\n');
		assert.equal(withVttNote('WEBVTT', ['a']), 'WEBVTT\n\nNOTE\na\n\n');
	});

	it('converts to SRT: hours added, settings, ids, NOTE and STYLE dropped, text and line breaks unchanged', () => {
		const vtt = 'WEBVTT\n\nSTYLE\n::cue { color: red }\n\nNOTE old note\n\ncue-1\n00:01.5 --> 00:03.250 line:90%\nفي <c.q>الأولى</c>\nسطر ثانٍ\n\n01:02:03.004 --> 01:02:04.000\n<i>two</i>\n';
		assert.equal(vttToSrt(vtt), '1\n00:00:01,500 --> 00:00:03,250\nفي الأولى\nسطر ثانٍ\n\n2\n01:02:03,004 --> 01:02:04,000\n<i>two</i>\n');
	});

	it('leaves no tag behind, even one split by another', () => {
		const srt = vttToSrt('WEBVTT\n\n00:00.000 --> 00:01.000\na<<c>script>b <scr<c>ipt>c <b>d</b>\n');
		assert.doesNotMatch(srt, /<(?!\/?b>)/);
		assert.match(srt, /<b>d<\/b>/);
	});

	it('an SRT keeps the attribution in a first zero-length cue; a VTT in a NOTE', () => {
		const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\n“[fixture translation 20 of 112:1]”\n';
		const srt = subtitleDownload(vtt, 'srt', { edition });
		assert.equal(srt.split('\n\n')[0], '1\n00:00:00,000 --> 00:00:00,000\nQuran data provided by Quran Foundation (https://quran.foundation/)\nبيانات القرآن مقدَّمة من مؤسسة القرآن (https://quran.foundation/‎)\nTranslation: Saheeh International');
		assert.match(srt, /\n\n2\n00:00:00,000 --> 00:00:01,000\n“\[fixture translation 20 of 112:1\]”\n$/);
		assert.match(subtitleDownload(vtt, 'vtt', { edition }), /^WEBVTT\n\nNOTE\n.*\nTranslation: Saheeh International\n\n00:00.000/s);
		assert.equal(subtitleDownload(vtt, 'vtt', null), vtt);
	});
});
