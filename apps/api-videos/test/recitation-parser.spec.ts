import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionAcceptedRecitationSpans, captionQuranMarker, renderCaptionVtt } from '@al-ummah/shared-types';

test('recitation spans use only accepted Arabic markers and carry no Quran or ASR text', () => {
  const vtt = renderCaptionVtt({
    language: 'ar',
    cues: [
      { id: 'c1', startMs: 1250, endMs: 4800, segments: [{ type: 'quran', range: '1:1:1-1:1:4', status: 'accepted', heard: 'synthetic recognition' }] },
      { id: 'c2', startMs: 5000, endMs: 6500, segments: [{ type: 'quran', range: '1:2:1-1:2:2', status: 'review', heard: 'unconfirmed recognition' }] },
      { id: 'c3', startMs: 7000, endMs: 8000, segments: [{ type: 'speech', text: 'ordinary caption' }] },
    ],
  });
  const spans = captionAcceptedRecitationSpans(vtt);
  assert.deepEqual(spans, [{ range: '1:1:1-1:1:4', startMs: 1250, endMs: 4800, boundary: 'cue' }]);
  assert.equal(JSON.stringify(spans).includes('synthetic recognition'), false);
  assert.equal(Object.hasOwn(spans[0]!, 'text'), false);
});

test('translated and reference markers do not become Arabic recitation spans', () => {
  const range = '2:255:1-2:255:3';
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n${captionQuranMarker(range, 'translation')}\n\n00:00:04.000 --> 00:00:05.000\n${captionQuranMarker(range, 'reference')}`;
  assert.deepEqual(captionAcceptedRecitationSpans(vtt), []);
});

test('spans are sorted, deduplicated, and invalid timings are omitted', () => {
  const range = '3:1:1-3:1:2';
  const cue = (start: string, end: string) => `${start} --> ${end} align:start\n${captionQuranMarker(range, 'text')}`;
  const vtt = [
    'WEBVTT',
    cue('00:00:09.000', '00:00:10.000'),
    cue('00:00:02.000', '00:00:04.000'),
    cue('00:00:02.000', '00:00:04.000'),
    cue('bad', '00:00:08.000'),
    cue('00:00:08.000', '00:00:08.000'),
  ].join('\n\n');
  assert.deepEqual(captionAcceptedRecitationSpans(vtt), [
    { range, startMs: 2000, endMs: 4000, boundary: 'cue' },
    { range, startMs: 9000, endMs: 10_000, boundary: 'cue' },
  ]);
});
