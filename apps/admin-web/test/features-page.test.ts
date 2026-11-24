/**
 * The Features page (wiki AUN-FEATURES §3, O39): grouping and search, the notes under a row, when a
 * switch asks first, the two-admins conflict, locks, the nav item, and the rendered rows in en and ar.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { FEATURE_GROUPS, FEATURE_REGISTRY, featureDefinition, type FeatureKey } from '@al-ummah/shared-types';
import type { FeatureItem } from '../src/lib/api/features';
import {
  applyConflict,
  applyWrite,
  preconditionText,
  confirmContent,
  featureNotes,
  foldSearch,
  groupFeatures,
  lockReason,
  needsConfirm,
  offCount,
  switchWords,
} from '../src/lib/features/page-model';
import { NAV_ITEMS, groupedItems, visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { FeaturesView } from '../src/components/features/FeaturesView';
import { FeatureStatusLine } from '../src/components/features/FeatureStatusLine';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

function item(key: FeatureKey, patch: Partial<FeatureItem> = {}): FeatureItem {
  const def = featureDefinition(key);
  return {
    key,
    enabled: def.default,
    effective: def.default,
    blockedBy: [],
    ready: true,
    setupNote: null,
    envOverride: false,
    parked: 0,
    version: 0,
    updatedAt: null,
    updatedBy: null,
    canToggle: true,
    ...patch,
  };
}

const all = (patch: (k: FeatureKey) => Partial<FeatureItem> = () => ({})) => FEATURE_REGISTRY.map((d) => item(d.key, patch(d.key)));

describe('Features page model: grouping and search', () => {
  it('keeps registry order inside each group and the groups in FEATURE_GROUPS order', () => {
    const groups = groupFeatures(all());
    assert.deepEqual(groups.map((g) => g.id), [...FEATURE_GROUPS]);
    assert.deepEqual(groups.flatMap((g) => g.rows.map((r) => r.item.key)), FEATURE_GROUPS.flatMap((g) => FEATURE_REGISTRY.filter((d) => d.group === g).map((d) => d.key)));
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), FEATURE_REGISTRY.length);
  });

  it('searches the name and the help text in the page language, every word, and drops empty groups', () => {
    assert.deepEqual(groupFeatures(all(), 'youtube').flatMap((g) => g.rows.map((r) => r.item.key)), ['youtubeImport']);
    // Help text, not only names: "footer" is only in the newsletter's help
    assert.deepEqual(groupFeatures(all(), 'footer').map((g) => g.id), ['site']);
    assert.deepEqual(groupFeatures(all(), 'رفع', 'ar').flatMap((g) => g.rows.map((r) => r.item.key)).includes('upload'), true);
    // Arabic letter variants fold: «الاستيراد» finds «الاستيراد» written with a plain alef
    assert.equal(foldSearch('أُوقفت'), foldSearch('اوقفت'));
    assert.deepEqual(groupFeatures(all(), 'zzz-nothing'), []);
    // English words don't match the Arabic page's text
    assert.deepEqual(groupFeatures(all(), 'uploads', 'ar'), []);
  });
});

describe('Features page model: state words and notes', () => {
  it('says On, Off, Paused (on but waiting for what it needs) or Off here (environment override)', () => {
    assert.equal(switchWords(item('upload')), 'on');
    assert.equal(switchWords(item('upload', { enabled: false, effective: false })), 'off');
    assert.equal(switchWords(item('youtubeImport', { effective: false, blockedBy: ['upload'] })), 'waiting');
    assert.equal(switchWords(item('aiCategorySuggest', { envOverride: true, effective: false })), 'envOff');
  });

  it('lists "Off while Uploads is off", needs setup with its link, the environment override and parked jobs', () => {
    assert.deepEqual(featureNotes(item('youtubeImport', { effective: false, blockedBy: ['upload'] }), 'en'), [{ kind: 'blocked', by: ['upload'] }]);
    const setup = featureNotes(item('youtubeImport', { ready: false, setupNote: { en: 'no Google client yet', ar: 'لم يُضف عميل Google بعد' } }), 'ar');
    assert.deepEqual(setup, [{ kind: 'needsSetup', note: 'لم يُضف عميل Google بعد', href: featureDefinition('youtubeImport').setupHref ?? null }]);
    // Switched off: no "needs setup" (it says what is wrong only while it should be working)
    assert.deepEqual(featureNotes(item('youtubeImport', { enabled: false, effective: false, ready: false }), 'en'), []);
    assert.deepEqual(featureNotes(item('aiCategorySuggest', { envOverride: true }), 'en'), [{ kind: 'envOverride' }]);
    assert.deepEqual(featureNotes(item('socialAutopost', { enabled: false, effective: false, parked: 1200 }), 'en'), [{ kind: 'parked', count: 1200 }]);
  });

  it('counts what is off for people right now', () => {
    assert.equal(offCount(all((k) => (k === 'upload' ? { enabled: false, effective: false } : {}))), FEATURE_REGISTRY.filter((d) => !d.default).length + 1);
  });
});

describe('Features page model: acting', () => {
  it('asks first only in the directions the entry\'s confirm covers', () => {
    assert.equal(needsConfirm({ confirm: 'both' }, true), true);
    assert.equal(needsConfirm({ confirm: 'both' }, false), true);
    assert.equal(needsConfirm({ confirm: 'off' }, false), true);
    assert.equal(needsConfirm({ confirm: 'off' }, true), false);
    assert.equal(needsConfirm({ confirm: 'on' }, true), true);
    assert.equal(needsConfirm({ confirm: 'on' }, false), false);
    assert.equal(needsConfirm({ confirm: 'never' }, false), false);
    // The registry's own entries: Tier requests asks before off, acts at once on
    assert.equal(needsConfirm(featureDefinition('tierRequests'), false), true);
    assert.equal(needsConfirm(featureDefinition('tierRequests'), true), false);
    assert.equal(needsConfirm(featureDefinition('captionsTranslate'), false), false);
  });

  it('lists the dependants that go off with it, and the owner decision for caption downloads', () => {
    const off = confirmContent('upload', false);
    assert.ok(off.dependants.includes('youtubeImport') && off.dependants.includes('audioTracks'));
    assert.deepEqual(confirmContent('upload', true).dependants, []);
    assert.equal(confirmContent('viewerCaptionDownload', true).ownerDecision, true);
    assert.equal(confirmContent('upload', false).ownerDecision, false);
  });

  it('locks the environment override, super-admin-only rows for admins, and everything for read-only roles', () => {
    assert.equal(lockReason(item('upload', { canToggle: true }), true), null);
    assert.equal(lockReason(item('upload', { canToggle: false }), true), 'superAdminOnly');
    assert.equal(lockReason(item('aiCategorySuggest', { canToggle: false, envOverride: true }), true), 'envOverride');
    assert.equal(lockReason(item('captionsTranslate', { canToggle: false }), false), 'readOnly');
  });

  it('a conflict takes the stored value and version admin-api sends (409 current) and keeps the rest of the row', () => {
    const list = all();
    const before = list.find((i) => i.key === 'upload')!;
    const items = applyConflict(list, 'upload', { enabled: false, version: 4 });
    const row = items.find((i) => i.key === 'upload')!;
    assert.equal(row.version, 4);
    assert.equal(row.enabled, false);
    assert.equal(row.updatedAt, before.updatedAt, 'who and when come with the reload');
    assert.equal(items.find((i) => i.key === 'youtubeImport')!.effective, false, 'what needs it follows at once');
    assert.deepEqual(applyConflict(list, 'upload', null), list, 'no current: the reload does it all');
  });

  it('the precondition sentence is the reason in the page language, else the page\'s own fallback, never the bare server text', () => {
    const reason = { en: 'Creator support can’t be switched on yet.', ar: 'لا يمكن تشغيل دعم صنّاع المحتوى بعد.' };
    assert.equal(preconditionText(reason, 'ar', 'fallback'), reason.ar);
    assert.equal(preconditionText(reason, 'en', 'fallback'), reason.en);
    assert.equal(preconditionText(null, 'ar', ar.features.preconditionFallback), 'لا يمكن تشغيل هذه الميزة بعد. راجع إعدادها ثم حاول مرة أخرى.');
  });

  it('a write recomputes what waits for it: Uploads off pauses Move from YouTube and Extra audio tracks', () => {
    const after = applyWrite(all(), 'upload', false, 1, { id: 'me', name: 'Me' }, '2026-11-22T15:40:00Z');
    const yt = after.find((i) => i.key === 'youtubeImport')!;
    assert.deepEqual(yt.blockedBy, ['upload']);
    assert.equal(yt.effective, false);
    assert.equal(yt.enabled, true, 'the dependant keeps its stored value');
    assert.equal(after.find((i) => i.key === 'upload')!.updatedBy?.name, 'Me');
    const back = applyWrite(after, 'upload', true, 2, null, '2026-11-22T15:41:00Z');
    assert.equal(back.find((i) => i.key === 'youtubeImport')!.effective, true);
  });
});

describe('Features nav item', () => {
  const moderator: NavAccess = { contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false };
  it('is in the Site group, for every admin role, never in the review-only shell', () => {
    const navItem = NAV_ITEMS.find((i) => i.href === '/features');
    assert.ok(navItem);
    assert.equal(navItem.group, 'site');
    assert.equal(navItem.label, 'nav.features');
    assert.ok(visibleItems(moderator).some((i) => i.href === '/features'));
    assert.ok(groupedItems(moderator).find((g) => g.id === 'site')!.items.some((i) => i.href === '/features'));
    assert.ok(!visibleItems({ ...moderator, reviewOnly: true }).some((i) => i.href === '/features'));
    assert.equal(en.nav.features, 'Features');
    assert.equal(ar.nav.features, 'الميزات');
  });
});

describe('Features page render', () => {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  const render = (items: FeatureItem[], locale = 'en', canManage = true) =>
    renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'dark' }, React.createElement(FeaturesView, { initial: items, canManage, me: { id: 'me', name: 'Me' }, actions: { setFeature: async () => ({ ok: true as const, data: { previous: true, enabled: true, version: 1 } }), featureHistory: async () => ({ entries: [], nextCursor: null }) } })) as never);

  it('shows every row with its help text, a switch and its state in words', () => {
    const html = render(all());
    assert.equal((html.match(/data-testid="feature-row"/g) ?? []).length, FEATURE_REGISTRY.length);
    assert.equal((html.match(/role="switch"/g) ?? []).length, FEATURE_REGISTRY.length);
    assert.match(html, /Switch features on or off for everyone\. Changes reach every app within 2 minutes\./);
    assert.ok(html.includes(featureDefinition('upload').help.en));
    assert.match(html, /data-testid="feature-status">Default</);
  });

  it('says who changed it, the dependency note and the read-only line', () => {
    const items = all((k) =>
      k === 'upload' ? { enabled: false, effective: false, updatedBy: { id: 'u', name: 'Fatima Rahman' }, updatedAt: '2026-11-22T15:28:00Z' } : k === 'youtubeImport' ? { effective: false, blockedBy: ['upload'] } : {},
    );
    const html = render(items);
    assert.match(html, /Changed by <bdi>Fatima Rahman<\/bdi>, <time/);
    assert.match(html, /Off while Uploads is off\./);
    assert.doesNotMatch(html, /data-testid="features-read-only"/);
    const ro = render(all((k) => ({ canToggle: false, ...(k === 'upload' ? {} : {}) })), 'en', false);
    assert.match(ro, /data-testid="features-read-only"/);
    assert.equal((ro.match(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/g) ?? []).length, FEATURE_REGISTRY.length);
  });

  it('a change by an account with no name (admin-api sends name: null) says "an admin", never an empty name', () => {
    const items = all((k) => (k === 'newsletter' ? { updatedBy: { id: 'u', name: null }, updatedAt: '2026-11-22T15:28:00Z' } : {}));
    assert.match(render(items), /Changed by <bdi>an admin<\/bdi>, <time/);
    assert.match(render(items, 'ar'), /<bdi>أحد المشرفين<\/bdi>، <time/);
  });

  it('Arabic: right words, «،» in the status line, never «·»', () => {
    const html = render(all((k) => (k === 'newsletter' ? { updatedBy: { id: 'u', name: 'Yusuf Ali' }, updatedAt: '2026-11-22T15:28:00Z' } : {})), 'ar');
    assert.match(html, /الميزات/);
    assert.match(html, /غيّرها <bdi>Yusuf Ali<\/bdi>، <time/);
    assert.doesNotMatch(html, /·/);
    const line = renderToStaticMarkup(React.createElement(Provider, { locale: 'ar', theme: 'dark' }, React.createElement(FeatureStatusLine, { featureKey: 'captionsTranscribe', item: { effective: true } })) as never);
    assert.match(line, /«التفريغ النصي» مفعّلة/);
    assert.match(line, /، /);
    assert.match(line, /href="\/features#captionsTranscribe"/);
  });
});

describe('Features messages', () => {
  it('uses typographic quotes and apostrophes in English, and Arabic digits only in Arabic', () => {
    const walk = (o: unknown, out: string[] = []): string[] => {
      if (typeof o === 'string') out.push(o);
      else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v, out);
      return out;
    };
    for (const s of walk(en.features)) assert.doesNotMatch(s, /['"]/, s);
    for (const s of walk(ar.features)) {
      assert.doesNotMatch(s, /[0-9]/, s);
      assert.doesNotMatch(s, /·/, s);
    }
  });
});
