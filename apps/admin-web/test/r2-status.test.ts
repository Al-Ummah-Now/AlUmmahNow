/**
 * R2 status in the admin (epic #687): the badge on the videos list and the
 * video page, the failure details, and the Delivery page's live figures,
 * in English and Arabic.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '../src/i18n/translate';
import type { AdminVideoR2, TranscodeFailure } from '../src/lib/api/content-types';
import type { MediaLive } from '../src/lib/api/types';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
type R2 = typeof import('../src/components/content/r2');
type Live = typeof import('../src/app/(protected)/delivery/live');
let r2m: R2;
let livem: Live;
before(async () => {
  r2m = await import('../src/components/content/r2');
  livem = await import('../src/app/(protected)/delivery/live');
});

const en = createTranslator('en');
const ar = createTranslator('ar');
const ARABIC = /[؀-ۿ]/;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const failure: TranscodeFailure = {
  stage: 'encode',
  stageDetail: '360p,480p,720p,1080p',
  error: 'ffmpeg exited 1',
  attempt: 2,
  elapsedMs: 95_000,
  at: '2026-11-11T10:00:00Z',
  source: { file: 'play_1080p.mp4', bytes: 50 * 1024 * 1024 },
  exitCode: 137,
  stopReason: 'oom',
  instanceId: 'inst-1',
  stderrTail: ['frame=100', 'Error while encoding <stream>'],
};
const base: AdminVideoR2 = { status: 'ready', jobId: 'j', rev: 'r', access: 'pub', attempts: 1, queuedAt: '2026-11-11T09:00:00Z', readyAt: '2026-11-11T09:05:00Z' };

describe('R2 badge', () => {
  it('names every state in words, with progress while transcoding', () => {
    const badge = (r2: Parameters<R2['R2Badge']>[0]['r2'], t = en, prefix = true) => text(renderToStaticMarkup(React.createElement(r2m.R2Badge, { r2, t, prefix })));
    assert.equal(badge({ status: 'queued' }), 'R2: Queued');
    assert.equal(badge({ status: 'transcoding', progress: 0.42 }), 'R2: Transcoding 42%');
    assert.equal(badge({ status: 'transcoding' }), 'R2: Transcoding');
    assert.equal(badge({ status: 'ready' }), 'R2: Ready');
    assert.equal(badge({ status: 'failed', error: 'x' }), 'R2: Failed');
    assert.equal(badge(null), 'R2: Not transcoded');
    assert.equal(badge({ status: 'ready' }, en, false), 'Ready', 'no prefix under the list column');
    assert.match(badge({ status: 'failed' }, ar), ARABIC);
    assert.match(renderToStaticMarkup(React.createElement(r2m.R2Badge, { r2: { status: 'failed' }, t: en })), /data-r2-status="failed"/);
  });
});

describe('R2 status on the video page', () => {
  const render = (r2: AdminVideoR2 | null, t = en, locale = 'en') => renderToStaticMarkup(React.createElement(r2m.R2Status, { r2, t, locale }));

  it('a video never transcoded says Bunny plays it', () => {
    const html = render(null);
    assert.match(html, /data-r2-status="none"/);
    assert.match(text(html), /Bunny plays it/);
  });

  it('transcoding shows an accessible progress bar', () => {
    const html = render({ ...base, status: 'transcoding', progress: 0.5, readyAt: undefined });
    assert.match(html, /role="progressbar"[^>]*aria-valuenow="50"/);
    assert.doesNotMatch(html, /r2-failure-details/);
  });

  it('a failed job shows its error and the failure details', () => {
    const html = render({ ...base, status: 'failed', failedAt: '2026-11-11T10:00:00Z', error: 'ffmpeg exited 1', failure });
    assert.match(html, /data-testid="r2-error"/);
    assert.match(html, /<details[^>]*data-testid="r2-failure-details"/);
    const t = text(html);
    for (const want of ['Details', 'Encoding (360p,480p,720p,1080p)', 'ffmpeg exited 1', 'Attempt', '1:35', 'play_1080p.mp4, 50 MB', '137', 'oom', 'inst-1']) assert.ok(t.includes(want), `missing ${want}: ${t}`);
    assert.match(html, /<pre dir="ltr"[^>]*>frame=100\nError while encoding &lt;stream&gt;<\/pre>/);
  });

  it('a retry under way still shows the earlier attempt\'s failure, as the last failure', () => {
    const html = render({ ...base, status: 'queued', readyAt: undefined, failure });
    assert.match(text(html), /Details of the last failure/);
    assert.doesNotMatch(html, /data-testid="r2-error"/);
  });

  it('a ready video hides an old failure', () => {
    assert.doesNotMatch(render({ ...base, failure }), /r2-failure-details/);
  });

  it('translates every stage, en and ar', () => {
    const stages = ['start', 'fetch_source', 'probe', 'encode', 'stills', 'upload', 'container'];
    assert.deepEqual(stages.map((s) => r2m.stageText(s, en)), ['Starting', 'Fetching the source', 'Reading the source', 'Encoding', 'Thumbnails', 'Uploading to R2', 'Container stopped']);
    assert.deepEqual(stages.map((s) => r2m.stageText(s, ar)), ['بدء', 'جلب المصدر', 'قراءة المصدر', 'الترميز', 'الصور المصغرة', 'الرفع إلى R2', 'توقف الحاوية']);
    assert.equal(r2m.stageText('mystery', en), 'mystery');
  });

  it('renders in Arabic', () => {
    const html = render({ ...base, status: 'failed', error: 'e', failure }, ar, 'ar');
    assert.match(text(html), /التفاصيل/);
    assert.match(html, /<pre dir="ltr"/);
  });
});

describe('live transcoder figures', () => {
  const live: MediaLive = { transcoding: 1, queued: 3, maxTranscodes: 2, oldestQueuedAt: '2026-11-11T11:45:00Z', oldestQueuedSeconds: 900, at: '2026-11-11T12:00:00Z' };
  const render = (l: MediaLive | null, extra: { stale?: boolean; t?: typeof en; locale?: string } = {}) =>
    renderToStaticMarkup(React.createElement(livem.LiveFigures, { live: l, t: extra.t ?? en, locale: extra.locale ?? 'en', stale: extra.stale }));
  const figure = (html: string, id: string) => text(new RegExp(`data-testid="${id}">([^<]*)<`).exec(html)?.[1] ?? '');

  it('shows N of M, the queue and the oldest wait', () => {
    const html = render(live);
    assert.equal(figure(html, 'delivery-live-transcoding'), '1 of 2');
    assert.equal(figure(html, 'delivery-live-queued'), '3');
    assert.equal(figure(html, 'delivery-live-oldest'), '15:00');
    assert.match(html, /aria-labelledby="delivery-live-title"/);
    assert.doesNotMatch(html, /delivery-live-stale/);
  });

  it('without a max shows the count alone, and nothing waiting says so', () => {
    const html = render({ ...live, maxTranscodes: null, queued: 0, oldestQueuedAt: null, oldestQueuedSeconds: null });
    assert.equal(figure(html, 'delivery-live-transcoding'), '1');
    assert.equal(figure(html, 'delivery-live-oldest'), 'Nothing waiting');
  });

  it('says when a refresh failed, and when there are no figures', () => {
    assert.match(render(live, { stale: true }), /delivery-live-stale/);
    assert.match(render(null), /delivery-live-unavailable/);
  });

  it('renders in Arabic with Arabic-Indic digits', () => {
    const html = render(live, { t: ar, locale: 'ar' });
    assert.match(figure(html, 'delivery-live-transcoding'), /^١ من ٢$/);
    assert.match(text(html), ARABIC);
  });
});
