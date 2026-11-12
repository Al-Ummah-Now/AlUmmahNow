import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeItem, badgeText, breadcrumbs, groupedItems, NAV_ITEMS, visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { fold, matchPages, move, paletteKinds, paletteOptions, START_PAGES } from '../src/components/shell/palette-model';
import { isDark, MODE_SCRIPT } from '../src/lib/color-mode';
import { acceptPackageCss } from '../src/lib/site-theme';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';

const moderator: NavAccess = { contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false };
const admin: NavAccess = { contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true };
const hrefs = (access: NavAccess) => visibleItems(access).map((i) => i.href);

describe('nav model', () => {
  it('keeps every section of the old top nav', () => {
    for (const href of ['/dashboard', '/moderation', '/moderation/ai', '/channels', '/videos', '/comments', '/playlists', '/community', '/deleted', '/users', '/category-suggestions', '/translations', '/indices', '/site-theme', '/contact', '/processing', '/stale-uploads', '/errors', '/jobs', '/creators', '/auth-requests', '/legacy-profiles', '/video-formats', '/delivery', '/operations']) {
      assert.ok(NAV_ITEMS.some((i) => i.href === href), href);
    }
  });

  it('hides from moderators exactly what the old nav hid', () => {
    const hidden = hrefs(admin).filter((h) => !hrefs(moderator).includes(h)).sort();
    assert.deepEqual(hidden, ['/contact', '/delivery', '/errors', '/legacy-profiles', '/operations', '/processing', '/stale-uploads', '/video-formats']);
  });

  it('shows Errors to whoever has errors:read or videos:processing', () => {
    assert.ok(hrefs({ ...moderator, errors: true }).includes('/errors'));
    assert.ok(hrefs({ ...moderator, processing: true }).includes('/errors'));
  });

  it('drops groups with nothing visible and keeps their order', () => {
    const ids = groupedItems(moderator).map((g) => g.id);
    assert.deepEqual(ids, ['overview', 'moderation', 'content', 'people', 'operations', 'site']);
    assert.deepEqual(groupedItems(moderator).find((g) => g.id === 'operations')!.items.map((i) => i.href), ['/jobs', '/indices']);
    assert.equal(groupedItems(admin).find((g) => g.id === 'operations')!.items[0].href, '/operations');
  });

  it('marks the most specific section as active', () => {
    const items = visibleItems(admin);
    assert.equal(activeItem('/moderation/ai/123', items)?.href, '/moderation/ai');
    assert.equal(activeItem('/moderation/reports/9', items)?.href, '/moderation');
    assert.equal(activeItem('/users/invites/new', items)?.href, '/users');
    assert.equal(activeItem('/nowhere', items), undefined);
  });

  it('builds breadcrumbs: group, then the section, linked from pages below it', () => {
    const items = visibleItems(admin);
    assert.deepEqual(breadcrumbs('/videos', items), [{ label: 'nav.groupContent' }, { label: 'nav.videos' }]);
    assert.deepEqual(breadcrumbs('/channels/ch_1', items), [{ label: 'nav.groupContent' }, { label: 'nav.channels', href: '/channels' }]);
    assert.deepEqual(breadcrumbs('/dashboard', items), [{ label: 'nav.dashboard' }]);
  });

  it('shows badges as 1–99, then 99+, and nothing for zero', () => {
    assert.equal(badgeText(0), null);
    assert.equal(badgeText(null), null);
    assert.equal(badgeText(7), '7');
    assert.equal(badgeText(100), '99+');
  });

  it('has every nav, group and palette string in English and Arabic', () => {
    assert.deepEqual(Object.keys(ar.nav).sort(), Object.keys(en.nav).sort());
    assert.deepEqual(Object.keys(ar.palette.groups).sort(), Object.keys(en.palette.groups).sort());
    const tAr = createTranslator('ar');
    for (const item of NAV_ITEMS) assert.notEqual(tAr(item.label), item.label, item.label);
  });
});

describe('command palette model', () => {
  const t = createTranslator('ar');
  const tEn = createTranslator('en');
  const items = visibleItems(admin);

  it('lists the first pages before anything is typed', () => {
    assert.equal(matchPages('', items, (i) => tEn(i.label), (i) => tEn(i.label)).length, START_PAGES);
  });

  it('finds pages by every typed word, in either language', () => {
    const found = matchPages('stale up', items, (i) => t(i.label), (i) => tEn(i.label));
    assert.deepEqual(found.map((o) => (o.type === 'page' ? o.item.href : '')), ['/stale-uploads']);
    const arabic = matchPages('تعليقات', items, (i) => t(i.label), (i) => tEn(i.label));
    assert.ok(arabic.some((o) => o.type === 'page' && o.item.href === '/comments'));
  });

  it('folds Arabic diacritics and case', () => {
    assert.equal(fold('Ḿoḋ'), 'mod');
    assert.equal(fold('مُشْرِف'), 'مشرف');
  });

  it('searches contact messages and errors only for those who can open them', () => {
    assert.deepEqual(paletteKinds(moderator), ['user', 'channel', 'video', 'playlist', 'report']);
    assert.deepEqual(paletteKinds(admin), ['user', 'channel', 'video', 'playlist', 'report', 'contact', 'error']);
  });

  it('puts pages first, then each kind in order, at most four of each', () => {
    const s = (kind: 'user' | 'video', n: number) => Array.from({ length: n }, (_, i) => ({ kind, id: `${kind}${i}`, label: `${kind} ${i}`, secondary: null, imageUrl: null }));
    const options = paletteOptions([], { video: s('video', 2), user: s('user', 6) }, ['user', 'video']);
    assert.deepEqual(options.map((o) => o.id), ['user-user0', 'user-user1', 'user-user2', 'user-user3', 'video-video0', 'video-video1']);
  });

  it('wraps the arrow keys and has no active option in an empty list', () => {
    assert.equal(move(-1, 3, 1), 0);
    assert.equal(move(-1, 3, -1), 2);
    assert.equal(move(2, 3, 1), 0);
    assert.equal(move(0, 3, -1), 2);
    assert.equal(move(0, 0, 1), -1);
  });
});

describe('colour mode', () => {
  it('is dark for dark, and for system when the system prefers dark', () => {
    assert.equal(isDark('dark', false), true);
    assert.equal(isDark('light', true), false);
    assert.equal(isDark('system', true), true);
    assert.equal(isDark('system', false), false);
  });

  it('runs in the browser with the same rule', () => {
    const classes = new Set<string>();
    let listener: (() => void) | undefined;
    const run = (mode: string, prefersDark: boolean) => {
      classes.clear();
      const root = {
        getAttribute: () => mode,
        classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
      };
      const g = {
        document: { documentElement: root },
        window: { matchMedia: () => ({ matches: prefersDark, addEventListener: (_: string, fn: () => void) => { listener = fn; } }) },
        MutationObserver: class { observe() {} },
      };
      new Function('document', 'window', 'MutationObserver', MODE_SCRIPT)(g.document, g.window, g.MutationObserver);
      return classes.has('dark');
    };
    assert.equal(run('dark', false), true);
    assert.equal(run('light', true), false);
    assert.equal(run('system', true), true);
    assert.equal(run('system', false), false);
    assert.ok(listener, 'follows the system setting live');
  });
});

describe('site theme package CSS', () => {
  it('accepts CSS scoped to its own theme only', () => {
    assert.equal(acceptPackageCss("html[data-theme='custom-1']{--x:1}", 'custom-1'), "html[data-theme='custom-1']{--x:1}");
    assert.equal(acceptPackageCss("html[data-theme='other']{--x:1}", 'custom-1'), null);
    assert.equal(acceptPackageCss("html[data-theme='custom-1']{}</style><script>", 'custom-1'), null);
  });
});
