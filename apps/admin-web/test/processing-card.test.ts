/**
 * The video page's Processing card: Bunny and R2 side by side,
 * resolution chips sorted by height with their state in words, the R2 source
 * used, time to ready, container time, live job events, in English and Arabic.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '../src/i18n/translate';
import type { AdminVideoR2 } from '../src/lib/api/content-types';

(globalThis as { React?: unknown }).React = React;
// CI resolves two copies of @types/react: render through a plain FC cast
const h = (component: unknown, props: object) => React.createElement(component as React.FC<object>, props) as never;
type P = typeof import('../src/components/content/processing');
type R2 = typeof import('../src/components/content/r2');
let pm: P;
let r2m: R2;
before(async () => {
  pm = await import('../src/components/content/processing');
  r2m = await import('../src/components/content/r2');
});

const en = createTranslator('en');
const ar = createTranslator('ar');
const ARABIC = /[؀-ۿ]/;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const chipStates = (html: string) => [...html.matchAll(/data-resolution="([^"]+)" data-state="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);

const ready: AdminVideoR2 = {
  status: 'ready',
  jobId: 'j1',
  rev: 'r',
  access: 'pub',
  attempts: 1,
  queuedAt: '2026-11-12T10:00:00Z',
  readyAt: '2026-11-12T10:04:30Z',
  containerSeconds: 200,
  rungs: [{ name: '1080p', state: 'done' }, { name: '360p', state: 'done' }, { name: '720p', state: 'done' }, { name: '480p', state: 'done' }],
  result: {
    rungs: [
      { name: '360p', width: 640, height: 360, bandwidth: 600_000, bytes: 20 * 1024 * 1024 },
      { name: '480p', width: 854, height: 480, bandwidth: 1_000_000, bytes: 40 * 1024 * 1024 },
      { name: '720p', width: 1280, height: 720, bandwidth: 2_400_000, bytes: 90 * 1024 * 1024 },
      { name: '1080p', width: 1920, height: 1080, bandwidth: 4_200_000, bytes: 160 * 1024 * 1024 },
    ],
    source: { width: 1920, height: 1080, file: 'original' },
  },
};

describe('resolution order', () => {
  it('sorts ascending by height: "360p 480p 720p 240p" puts 240p first', () => {
    assert.deepEqual(pm.sortResolutions(['360p', '480p', '720p', '240p']), ['240p', '360p', '480p', '720p']);
    assert.deepEqual(pm.sortResolutions(['1080p', '2160p', '720p', 'audio', '144p']), ['144p', '720p', '1080p', '2160p', 'audio']);
  });

  it('Bunny chips follow the sort, are all done, and Bunny gets no invented pending chips', () => {
    const html = renderToStaticMarkup(h(pm.BunnySource, { processing: { status: 'transcoding', encodeProgress: 60, resolutions: ['360p', '480p', '720p', '240p'] }, t: en, locale: 'en' }));
    assert.deepEqual(chipStates(html), ['240p:done', '360p:done', '480p:done', '720p:done']);
    assert.match(text(html), /Status: Encoding 60%/);
    assert.match(text(html), /Overall 60%/);
    assert.match(html, /role="progressbar"[^>]*aria-valuenow="60"/);
  });
});

describe('Bunny status line', () => {
  const line = (processing: unknown, issue: unknown = null, t = en) => pm.bunnyStatusText(processing as never, issue as never, t);
  it('queued, encoding N%, finished, failed', () => {
    assert.equal(line({ status: 'uploaded', encodeProgress: 0, resolutions: [] }), 'Queued');
    assert.equal(line({ status: 'transcoding', encodeProgress: 35, resolutions: [] }), 'Encoding 35%');
    assert.equal(line({ status: 'finished', encodeProgress: 100, resolutions: ['720p'] }), 'Finished');
    assert.equal(line({ status: 'error', encodeProgress: 10, resolutions: [] }), 'Failed: error');
    assert.match(line({ status: 'transcoding', encodeProgress: 35, resolutions: [] }, { kind: 'stalled', at: 'x' }), /^Failed: /);
    assert.equal(pm.bunnyInProgress({ status: 'transcoding', encodeProgress: 1, resolutions: [] }), true);
    assert.equal(pm.bunnyInProgress({ status: 'finished', encodeProgress: 100, resolutions: [] }), false);
    assert.match(line({ status: 'finished', encodeProgress: 100, resolutions: [] }, null, ar), ARABIC);
  });
});

describe('R2 chips', () => {
  it('a ready rendition: every rung filled, lowest first, with bitrate and size', () => {
    const html = renderToStaticMarkup(h(pm.R2Extras, { r2: ready, t: en, locale: 'en' }));
    assert.deepEqual(chipStates(html), ['360p:done', '480p:done', '720p:done', '1080p:done']);
    const t = text(html);
    assert.ok(t.includes('2.4 Mb/s') || t.includes('2.4 Mbps'), t);
    assert.ok(t.includes('90 MB'), t);
    assert.ok(t.includes('Done'), 'done says so in words (screen readers)');
  });

  it('while it uploads: done, uploading with its %, waiting', () => {
    const r2: AdminVideoR2 = { ...ready, status: 'transcoding', readyAt: undefined, result: undefined, rungs: [{ name: '720p', state: 'uploading', progress: 0.4 }, { name: '360p', state: 'done' }, { name: '1080p', state: 'pending' }, { name: '480p', state: 'done' }] };
    const html = renderToStaticMarkup(h(pm.R2Extras, { r2, t: en, locale: 'en' }));
    assert.deepEqual(chipStates(html), ['360p:done', '480p:done', '720p:uploading', '1080p:pending']);
    assert.match(html, /data-state="uploading" data-testid="resolution-chip" data-progress="40"/);
    assert.match(html, /motion-safe:animate-pulse/, 'animated only when motion is allowed');
    const t = text(html);
    assert.ok(t.includes('Uploading 40%') && t.includes('Waiting'), t);
  });

  it('while it encodes: every rung shows the shared %', () => {
    const r2: AdminVideoR2 = { ...ready, status: 'transcoding', result: undefined, rungs: ['360p', '720p'].map((name) => ({ name, state: 'encoding' as const, progress: 0.25 })) };
    assert.equal((text(renderToStaticMarkup(h(pm.R2Extras, { r2, t: en, locale: 'en' }))).match(/Encoding 25%/g) ?? []).length, 2);
  });

  it('a failed rung is red, focusable, and its reason is reachable by keyboard and screen reader', () => {
    const r2: AdminVideoR2 = {
      ...ready,
      status: 'failed',
      result: undefined,
      error: 'put HTTP 500',
      failure: { stage: 'upload', error: 'put HTTP 500', attempt: 3, elapsedMs: 1, at: 'x' },
      rungs: [{ name: '360p', state: 'done' }, { name: '720p', state: 'failed' }],
    };
    const html = renderToStaticMarkup(h(pm.R2Extras, { r2, t: en, locale: 'en' }));
    assert.deepEqual(chipStates(html), ['360p:done', '720p:failed']);
    assert.match(html, /<button type="button" class="[^"]*bg-danger-bg[^"]*" aria-describedby="r2-720p-reason" title="Failed: put HTTP 500"/);
    assert.match(html, /<span role="tooltip" id="r2-720p-reason"[^>]*>Failed: put HTTP 500<\/span>/);
    assert.ok(text(html).includes('720p · Failed'), 'state in words, not colour alone');
  });

  it('never transcoded or still queued: no chips', () => {
    assert.deepEqual(pm.r2Chips(null), []);
    assert.deepEqual(pm.r2Chips({ ...ready, status: 'queued', rungs: undefined, result: undefined }), []);
  });
});

describe('R2 extras', () => {
  it('source used: original with its size, or Bunny\'s MP4', () => {
    assert.equal(pm.r2SourceText(ready, en), 'Original (1920×1080)');
    assert.equal(pm.r2SourceText({ ...ready, result: { ...ready.result!, source: { width: 1920, height: 1080, file: 'play_1080p.mp4' } } }, en), 'Bunny MP4 1080p');
    assert.equal(pm.r2SourceText({ ...ready, result: undefined }, en), null);
    assert.match(pm.r2SourceText({ ...ready, result: { ...ready.result!, source: { width: 1920, height: 1080, file: 'play_720p.mp4' } } }, ar)!, /720p/);
  });

  it('time to ready is readyAt − queuedAt, and container time shows', () => {
    assert.equal(pm.r2TimeToReadySeconds(ready), 270);
    assert.equal(pm.r2TimeToReadySeconds({ ...ready, status: 'transcoding' }), null);
    const t = text(renderToStaticMarkup(h(pm.R2Extras, { r2: ready, t: en, locale: 'en' })));
    assert.ok(t.includes('Time to ready 4:30'), t);
    assert.ok(t.includes('Container time 3:20'), t);
    assert.ok(t.includes('Source used Original (1920×1080)'), t);
  });

  it('the R2 status block carries the chips and extras, in Arabic too', () => {
    const html = renderToStaticMarkup(h(r2m.R2Status, { r2: ready, t: ar, locale: 'ar' }));
    assert.match(html, /data-testid="r2-resolutions"/);
    assert.match(text(html), /الوقت حتى الجاهزية/);
    assert.match(text(html), /المصدر المستخدم/);
    assert.match(html, /aria-label="دقات R2"/);
  });
});

describe('live job events', () => {
  const running: AdminVideoR2 = { ...ready, status: 'transcoding', readyAt: undefined, result: undefined, rungs: undefined, progress: 0.1 };
  it('patches status, attempt, progress and rungs from a job event of this job', () => {
    const out = pm.r2FromLiveEvent(running, { kind: 'job', key: 'job:v', jobId: 'j1', status: 'transcoding', attempt: 2, progress: 0.99, rungs: [['360p', 'done'], ['720p', 'uploading', 0.4]] });
    assert.equal(out.refetch, false);
    assert.equal(out.r2?.attempts, 2);
    assert.equal(out.r2?.progress, 0.99);
    assert.deepEqual(out.r2?.rungs, [{ name: '360p', state: 'done' }, { name: '720p', state: 'uploading', progress: 0.4 }]);
  });
  it('re-reads the video when the event was cut, is another job, or finishes', () => {
    assert.equal(pm.r2FromLiveEvent(running, { kind: 'job', key: 'job:v', truncated: true }).refetch, true);
    assert.equal(pm.r2FromLiveEvent(running, { kind: 'job', key: 'job:v', jobId: 'other', status: 'queued' }).refetch, true);
    const done = pm.r2FromLiveEvent(running, { kind: 'job', key: 'job:v', jobId: 'j1', status: 'ready', attempt: 1 });
    assert.equal(done.refetch, true);
    assert.equal(done.r2?.status, 'ready');
  });
});
