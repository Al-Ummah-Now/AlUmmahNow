/**
 * Live streaming page logic: what a mode or split choice sends, what Undo
 * sends back (a change then its Undo restores every field), which change asks
 * first, override and stream-move inverses, the comparison's charts and
 * "better" marks, the history lines, and the pass-through allowlist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIVE_ROUTING, cleanLiveRoutingPatch, type LiveComparison, type LiveProviderStats, type LiveRoutingSettings } from '@al-ummah/shared-types';
import {
  COMPARISON_ROWS,
  applyPatch,
  auditTarget,
  betterOf,
  changeLines,
  chartSeries,
  clampSplit,
  dayRange,
  isStuck,
  mergeSessions,
  metricFormatter,
  modePatch,
  needsConfirm,
  overrideUndo,
  parseAmount,
  parseLimit,
  splitLabel,
  undoPatchFor,
  type LiveSessionItem,
} from '../src/lib/live-streaming';
import { isAllowedContentPath } from '../src/lib/api/content-proxy';

const base: LiveRoutingSettings = structuredClone(DEFAULT_LIVE_ROUTING);

describe('live streaming: mode and split', () => {
  it('a mode choice sends only the mode; Weighted carries the split on 5 % steps', () => {
    assert.deepEqual(modePatch('round_robin'), { mode: 'round_robin' });
    assert.deepEqual(modePatch('only_bunny', 70), { mode: 'only_bunny' });
    assert.deepEqual(modePatch('weighted', 70), { mode: 'weighted', bunnyPercent: 70 });
    assert.deepEqual(modePatch('weighted', 72), { mode: 'weighted', bunnyPercent: 70 });
    assert.deepEqual(modePatch('weighted', 140), { mode: 'weighted', bunnyPercent: 100 });
    assert.equal(clampSplit(Number.NaN), 50);
    assert.equal(splitLabel(70), '70/30');
    assert.equal(splitLabel(-5), '0/100');
  });

  it('a patch survives the admin-api filter unchanged (nothing the page sends is dropped)', () => {
    for (const patch of [modePatch('weighted', 30), { providers: { bunny: { enabled: false, note: 'preview' } } }, { selfhosted: { idleTimeoutSec: 90 }, qoeSampleRate: 0.5 }, { rates: { selfhosted: { perMillionRequestsUsd: 0.3 } } }]) {
      assert.deepEqual(cleanLiveRoutingPatch(patch), patch);
    }
  });
});

describe('live streaming: undo', () => {
  const changes = [
    modePatch('weighted', 70),
    modePatch('only_selfhosted'),
    { providers: { bunny: { draining: true, note: 'maintenance' } } },
    { providers: { selfhosted: { maxConcurrent: 10, monthlyBudgetUsd: 50 } } },
    { rates: { bunny: { perStreamHourUsd: 0.2 } } },
    { fallback: false },
    { selfhosted: { lowLatency: true, idleTimeoutSec: 30 }, qoeSampleRate: 1 },
  ];

  it('Undo sends back exactly the replaced fields, and applying it restores the settings', () => {
    for (const patch of changes) {
      const undo = undoPatchFor(base, patch);
      assert.deepEqual(Object.keys(undo).sort(), Object.keys(patch).sort(), JSON.stringify(patch));
      const after = applyPatch(base, patch);
      assert.notDeepEqual(after, base, JSON.stringify(patch));
      assert.deepEqual(applyPatch(after, undo), base, JSON.stringify(patch));
    }
  });

  it('Undo of a mode change keeps the stored split', () => {
    const weighted = applyPatch(base, modePatch('weighted', 70));
    const undo = undoPatchFor(weighted, modePatch('only_bunny'));
    assert.deepEqual(undo, { mode: 'weighted' });
  });

  it('only turning a provider off asks first', () => {
    assert.equal(needsConfirm(base, { providers: { bunny: { enabled: false } } }), 'bunny');
    assert.equal(needsConfirm(base, { providers: { selfhosted: { enabled: false } } }), 'selfhosted');
    const off = applyPatch(base, { providers: { bunny: { enabled: false } } });
    assert.equal(needsConfirm(off, { providers: { bunny: { enabled: true } } }), null);
    assert.equal(needsConfirm(off, { providers: { bunny: { enabled: false } } }), null, 'already off');
    for (const patch of changes) assert.equal(needsConfirm(base, patch), null);
  });

  it('an override\'s Undo puts back the provider it replaced, or removes it', () => {
    assert.deepEqual(overrideUndo('ch_1', null), { kind: 'remove', channelId: 'ch_1' });
    assert.deepEqual(overrideUndo('ch_1', { provider: 'bunny', note: 'x' }), { kind: 'set', channelId: 'ch_1', provider: 'bunny', note: 'x' });
  });

  it('limits: empty is no limit, anything else must be a number of 0 or more', () => {
    assert.equal(parseLimit(''), null);
    assert.equal(parseLimit(' 12 '), 12);
    assert.equal(parseLimit('-1'), undefined);
    assert.equal(parseLimit('ten'), undefined);
    assert.equal(parseAmount(''), undefined);
    assert.equal(parseAmount('0.005'), 0.005);
    assert.equal(parseAmount('2', 1), undefined);
  });
});

describe('live streaming: sessions', () => {
  const s = (id: string, status: LiveSessionItem['status'], created: number, last?: number): LiveSessionItem => ({ id, stream_id: `ls_${id}`, channel_id: 'ch', provider: 'selfhosted', status, reason: 'round_robin', created_at: created, last_segment_at: last ?? null });

  it('active sessions come first and appear once', () => {
    const rows = mergeSessions([s('a', 'live', 1)], [s('b', 'ended', 5), s('a', 'live', 1), s('c', 'provisioned', 3)]);
    assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b']);
  });

  it('marks a session with no segment for a while as possibly stuck', () => {
    const now = 1_000_000_000;
    assert.equal(isStuck(s('a', 'live', now - 600_000, now - 300_000), now, 60), true);
    assert.equal(isStuck(s('a', 'live', now - 600_000, now - 10_000), now, 60), false);
    assert.equal(isStuck(s('a', 'ended', now - 600_000, now - 300_000), now, 60), false);
  });
});

describe('live streaming: comparison', () => {
  const stats = (provider: 'bunny' | 'selfhosted', over: Partial<LiveProviderStats>): LiveProviderStats => ({
    provider, sessions: 2, failedSessions: 0, failovers: 0, streamHours: 1, viewerHours: 10, peakViewers: 5, startupMsP50: 900, startupMsP95: 2000, latencyMsP50: 5000, latencyMsP95: 8000,
    rebufferRatio: 0.01, rebuffersPerViewerHour: 1, avgBitrateKbps: 2500, switchesPerViewerHour: 3, droppedFramesPerViewerHour: 10, errorsPerViewerHour: 0.1, ingestConnectMsP50: 300,
    firstSegmentMsP50: 2000, reconnects: 0, reconnectRecoveryMsP50: null, vodReadyMsP50: 60000, estCostUsd: 1, costPerStreamHourUsd: 1, costPerViewerHourUsd: 0.1,
    units: { deliveredGb: 1, edgeRequests: 1, storedGb: 1, ingestGb: 1 }, qoeSamples: 10, ...over,
  });
  const comparison: LiveComparison = {
    from: '2026-11-01', to: '2026-11-03',
    providers: [stats('bunny', { latencyMsP50: 4000 }), stats('selfhosted', { latencyMsP50: 6000, estCostUsd: 0.5 })],
    days: [
      { day: '2026-11-01', provider: 'bunny', sessions: 1, viewerHours: 4, latencyMsP50: 4000, rebufferRatio: 0.02, estCostUsd: 2 },
      { day: '2026-11-03', provider: 'bunny', sessions: 1, viewerHours: 0, latencyMsP50: 4100, rebufferRatio: null, estCostUsd: 0 },
      { day: '2026-11-02', provider: 'selfhosted', sessions: 1, viewerHours: 2, latencyMsP50: 6000, rebufferRatio: 0.01, estCostUsd: 0.5 },
    ],
  };

  it('has a row for every measure the owner asked for', () => {
    const keys = COMPARISON_ROWS.map((r) => r.key);
    for (const k of ['sessions', 'failovers', 'streamHours', 'viewerHours', 'startupP50', 'startupP95', 'latencyP50', 'latencyP95', 'rebufferRatio', 'bitrate', 'switches', 'droppedFrames', 'errors', 'ingestConnectP50', 'firstSegmentP50', 'reconnects', 'recoveryP50', 'vodReadyP50', 'estCost', 'costPerStreamHour', 'costPerViewerHour']) {
      assert.ok(keys.includes(k), k);
    }
  });

  it('marks the better provider per measure, never on a tie or missing data', () => {
    const [bunny, selfhosted] = comparison.providers;
    const row = (k: string) => COMPARISON_ROWS.find((r) => r.key === k)!;
    assert.equal(betterOf(row('latencyP50'), bunny, selfhosted), 'bunny');
    assert.equal(betterOf(row('estCost'), bunny, selfhosted), 'selfhosted');
    assert.equal(betterOf(row('sessions'), bunny, selfhosted), null);
    assert.equal(betterOf(row('recoveryP50'), bunny, selfhosted), null);
    assert.equal(betterOf(row('latencyP50'), bunny, null), null);
  });

  it('daily series cover every day; a day without data is a gap, never a zero', () => {
    assert.deepEqual(dayRange('2026-11-01', '2026-11-03'), ['2026-11-01', '2026-11-02', '2026-11-03']);
    const latency = chartSeries(comparison, 'latency');
    assert.deepEqual(latency.days, ['2026-11-01', '2026-11-02', '2026-11-03']);
    assert.deepEqual(latency.series.find((s) => s.provider === 'bunny')?.values, [4000, null, 4100]);
    assert.deepEqual(latency.series.find((s) => s.provider === 'selfhosted')?.values, [null, 6000, null]);
    const cost = chartSeries(comparison, 'costPerViewerHour');
    assert.deepEqual(cost.series.find((s) => s.provider === 'bunny')?.values, [0.5, null, null], 'no viewer hours: no cost per viewer-hour');
    assert.deepEqual(chartSeries(null, 'rebuffer'), { days: [], series: [] });
  });

  it('formats values in the admin\'s language, with a dash for no data', () => {
    assert.equal(metricFormatter('en', 'ms')(null), '—');
    assert.match(metricFormatter('en', 'ms')(4500), /4\.5\s?s/);
    assert.match(metricFormatter('en', 'ratio')(0.0125), /1\.25\s?%/);
    assert.match(metricFormatter('ar', 'count')(12), /١٢/);
  });
});

describe('live streaming: history and pass-through', () => {
  it('turns an audit row into one line per changed field with the old value', () => {
    assert.deepEqual(changeLines({ providers: { bunny: { enabled: false } } }, { providers: { bunny: { enabled: true } } }), [{ field: 'providers.bunny.enabled', value: false, previous: true }]);
    assert.deepEqual(changeLines(null, { provider: 'bunny', note: null }), [
      { field: 'provider', value: null, previous: 'bunny' },
      { field: 'note', value: null, previous: null },
    ]);
    assert.deepEqual(auditTarget('content:live-override:ch_1'), { kind: 'live-override', id: 'ch_1' });
  });

  it('the browser may call exactly the live routes', () => {
    const ok = (m: string, p: string) => isAllowedContentPath(m, p.split('/'));
    assert.equal(ok('GET', 'live/settings'), true);
    assert.equal(ok('GET', 'live/compare'), true);
    assert.equal(ok('GET', 'live/audit'), true);
    assert.equal(ok('PUT', 'live/settings'), true);
    assert.equal(ok('PUT', 'live/overrides/ch_1'), true);
    assert.equal(ok('DELETE', 'live/overrides/ch_1'), true);
    assert.equal(ok('POST', 'live/streams/ls_1/move'), true);
    assert.equal(ok('POST', 'live/sessions/s_1/end'), true);
    assert.equal(ok('DELETE', 'live/settings'), false);
    assert.equal(ok('POST', 'live/settings'), false);
    assert.equal(ok('GET', 'live/overrides/ch_1'), false);
  });
});

describe('live streaming: page render', () => {
  it('renders in English and Arabic: the 15 s note, Bunny\'s pending preview as unavailable (not an error), read-only for moderators', async () => {
    await import('./support/next-navigation-stub');
    const React = await import('react');
    (globalThis as unknown as { React: unknown }).React = React;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const { LiveStreamingView } = await import('../src/components/live/LiveStreamingView');
    const en = (await import('../src/i18n/messages/en')).default;
    const ar = (await import('../src/i18n/messages/ar')).default;
    const view = {
      settings: base,
      usage: { bunny: { active: 0, monthSpendUsd: 0, available: false }, selfhosted: { active: 2, monthSpendUsd: 1.5, available: true } },
      overrides: [{ channelId: 'ch_1', channelName: 'Test channel', provider: 'bunny' as const, note: null, updatedBy: 'a', updatedAt: '2026-11-11T00:00:00Z' }],
    };
    const render = (locale: 'en' | 'ar', canManage: boolean) => {
      // Casts as in confirm-dialog.test.ts: the linked install has two @types/react
      const child = React.createElement(LiveStreamingView as never, {
        initial: { view, active: [], recent: [], comparison: null, audit: [] },
        loadFailed: false,
        range: { from: '2026-11-01', to: '2026-11-11', tests: false },
        canManage,
      } as never);
      return renderToStaticMarkup(React.createElement(I18nProvider as never, { locale, theme: 'light' } as never, child) as never);
    };
    const html = render('en', true);
    assert.ok(html.includes(en.live.appliesNote));
    assert.ok(html.includes(en.live.provider.unavailableBunny));
    assert.ok(!html.includes('role="alert"'), 'nothing shows as an error');
    assert.ok(html.includes('data-testid="live-override-add"'));
    assert.ok(html.includes('Test channel'));
    const moderator = render('ar', false);
    assert.ok(moderator.includes(ar.live.appliesNote));
    assert.ok(moderator.includes(ar.live.readOnly));
    assert.ok(!moderator.includes('data-testid="live-override-add"'), 'no change controls for a moderator');
  });
});
