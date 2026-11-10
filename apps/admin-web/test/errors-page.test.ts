/**
 * Errors page: who sees it, which filters reach admin-api, which buttons a
 * role gets, where needs-action items link, and en/ar labels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canManageErrors, canReadErrors } from '../src/lib/roles';
import { errorGroupsQuery, errorsBadgeCount, errorsHref, parseErrorFilters, searchedRef, thumbnailFixHref } from '../src/app/(protected)/errors/filters';
import { shapesMatch } from '@al-ummah/shared-types';
import { groupActionsFor, itemActionsFor, itemHref } from '../src/app/(protected)/errors/permissions';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const ARABIC = /[؀-ۿ]/;

describe('errors access (mirrors admin-api errors:read / errors:manage)', () => {
  it('is for admins and super admins, not moderators', () => {
    for (const role of ['admin', 'Super Admin', 'super_admin']) {
      assert.equal(canReadErrors(role), true, role);
      assert.equal(canManageErrors(role), true, role);
    }
    for (const role of ['moderator', 'user', undefined]) {
      assert.equal(canReadErrors(role), false, String(role));
      assert.equal(canManageErrors(role), false, String(role));
    }
  });
});

describe('errors list filters → admin-api query string', () => {
  it('passes every filter, the sort and the page window', () => {
    const f = parseErrorFilters({ app: 'web', environment: 'stage', release: 'abc123def456', status: 'new', from: '2026-11-01', to: '2026-11-09', q: '  TypeError ', sort: 'users', page: '3' });
    const q = new URLSearchParams(errorGroupsQuery(f));
    assert.deepEqual(Object.fromEntries(q), {
      app: 'web',
      environment: 'stage',
      release: 'abc123def456',
      status: 'new',
      from: '2026-11-01',
      to: '2026-11-09',
      q: 'TypeError',
      sort: 'users',
      limit: '25',
      offset: '50',
    });
  });

  it('drops values admin-api would reject and defaults the sort', () => {
    const f = parseErrorFilters({ app: 'auth', environment: 'Prod Env', release: 'a b', status: 'deleted', from: 'yesterday', sort: 'random', page: '-2' });
    assert.equal(errorGroupsQuery(f), 'sort=last_seen&limit=25&offset=0');
  });

  it('the Needs action tab filters on open items', () => {
    const f = parseErrorFilters({ tab: 'needs-action', sort: 'count' });
    assert.equal(f.needsAction, true);
    assert.equal(new URLSearchParams(errorGroupsQuery(f)).get('needsAction'), '1');
    assert.equal(errorsHref(f), '/errors?tab=needs-action&sort=count');
    assert.equal(errorsHref({ ...f, needsAction: false, sort: 'last_seen', page: 1 }), '/errors');
  });

  it('a pasted reference, even typed loosely, jumps to its group', () => {
    assert.equal(searchedRef(parseErrorFilters({ q: 'err 3k9f 2b7q' })), 'ERR-3K9F-2B7Q');
    assert.equal(searchedRef(parseErrorFilters({ q: 'ERR-3K9F-2B7Q' })), 'ERR-3K9F-2B7Q');
    assert.equal(searchedRef(parseErrorFilters({ q: 'TypeError: x is undefined' })), null);
  });

  it('nav badge = new groups + open needs-action items', () => {
    assert.equal(errorsBadgeCount({ new: 3, openActions: 2 }), 5);
    assert.equal(errorsBadgeCount(null), 0);
  });
});

describe('errors actions are gated by errors:manage', () => {
  const group = { status: 'new' as const, assignee_id: null };

  it('read-only roles get no buttons', () => {
    assert.deepEqual(groupActionsFor('moderator', group, 'usr_1'), []);
    assert.deepEqual(itemActionsFor('moderator', { status: 'open', can_retry: true }), []);
  });

  it('managers get the buttons that fit the status', () => {
    assert.deepEqual(groupActionsFor('admin', group, 'usr_1'), ['acknowledge', 'resolve', 'ignore', 'assignMe', 'note']);
    assert.deepEqual(groupActionsFor('admin', { status: 'resolved', assignee_id: 'usr_1' }, 'usr_1'), ['reopen', 'unassign', 'note']);
    assert.deepEqual(groupActionsFor('admin', { status: 'acknowledged', assignee_id: 'usr_2' }, 'usr_1'), ['resolve', 'ignore', 'assignMe', 'unassign', 'note']);
    assert.deepEqual(groupActionsFor('super_admin', { status: 'ignored', assignee_id: null }, 'usr_1'), ['resolve', 'reopen', 'assignMe', 'note']);
  });

  it('Retry only when admin-api has a retry; nothing on closed items', () => {
    assert.deepEqual(itemActionsFor('admin', { status: 'open', can_retry: true }), ['retry', 'dismiss']);
    assert.deepEqual(itemActionsFor('admin', { status: 'open', can_retry: false }), ['dismiss']);
    assert.deepEqual(itemActionsFor('admin', { status: 'resolved', can_retry: true }), []);
    assert.deepEqual(itemActionsFor('admin', { status: 'dismissed', can_retry: true }), []);
  });
});

describe('needs-action item links', () => {
  const web = 'https://alummahnow.net';
  it('uses item_url (admin path or our https hosts only)', () => {
    assert.equal(itemHref({ item_url: '/contact/ct_1', item_type: null, item_id: null }, web, 'en'), '/contact/ct_1');
    assert.equal(itemHref({ item_url: 'https://cms.alummahnow.net/x', item_type: null, item_id: null }, web, 'en'), 'https://cms.alummahnow.net/x');
    assert.equal(itemHref({ item_url: 'https://evil.example/x', item_type: null, item_id: null }, web, 'en'), null);
    assert.equal(itemHref({ item_url: '//evil.example/x', item_type: null, item_id: null }, web, 'en'), null);
    assert.equal(itemHref({ item_url: 'javascript:alert(1)', item_type: null, item_id: null }, web, 'en'), null);
  });

  it('falls back to the public video page for a video', () => {
    assert.equal(itemHref({ item_url: null, item_type: 'video', item_id: 'vid 1' }, `${web}/`, 'ar'), 'https://alummahnow.net/ar/video/vid%201');
    assert.equal(itemHref({ item_url: null, item_type: 'email', item_id: 'x' }, web, 'en'), null);
  });
});

describe('errors labels', () => {
  it('every errors string exists in Arabic, translated', () => {
    for (const ns of ['errorsPage', 'errorStatus', 'itemStatus', 'itemSource', 'errorActivity'] as const) {
      const enNs = en[ns] as Record<string, string>;
      const arNs = ar[ns] as Record<string, string>;
      assert.deepEqual(Object.keys(arNs).sort(), Object.keys(enNs).sort(), ns);
      for (const [key, value] of Object.entries(arNs)) {
        if (key === 'timelineHour') continue;
        assert.match(value, ARABIC, `${ns}.${key}`);
      }
    }
    assert.equal(en.nav.errors, 'Errors');
    assert.match(ar.nav.errors, ARABIC);
    assert.equal(en.errorsPage.deleteTestGroup, 'Delete test group');
    assert.equal(ar.errorsPage.deleteTestGroup, 'حذف مجموعة الاختبار');
  });
});

describe('thumbnails that do not match their video (owner edits them by hand)', () => {
  it('each flagged thumbnail links to its video page, where the upload crops to the shape', () => {
    assert.equal(thumbnailFixHref('0a3a5049-1b2c'), '/videos/0a3a5049-1b2c');
    assert.equal(thumbnailFixHref('a/b c'), '/videos/a%2Fb%20c');
  });

  it('the upload crops only an image of another shape (5% like the API)', () => {
    assert.equal(shapesMatch({ width: 1280, height: 720 }, { width: 1920, height: 1080 }), true);
    assert.equal(shapesMatch({ width: 1280, height: 696 }, { width: 1920, height: 1080 }), true);
    assert.equal(shapesMatch({ width: 640, height: 480 }, { width: 1440, height: 1440 }), false);
    assert.equal(shapesMatch({ width: 1280, height: 720 }, { width: 1080, height: 1920 }), false);
  });

  it('section, hint, crop dialog and refusal are labelled in English and Arabic', () => {
    const keys = [
      ['errorsPage', 'thumbFlaggedTitle'], ['errorsPage', 'thumbFlaggedHint'], ['errorsPage', 'thumbFlaggedEmpty'], ['errorsPage', 'thumbFlaggedCaption'],
      ['videos', 'cropTitle'], ['videos', 'cropHelp'], ['videos', 'cropFrameLabel'], ['videos', 'cropZoom'], ['videos', 'cropUse'], ['videos', 'cropFailed'],
    ] as const;
    for (const [section, key] of keys) {
      const e = (en as unknown as Record<string, Record<string, string>>)[section][key];
      const a = (ar as unknown as Record<string, Record<string, string>>)[section][key];
      assert.ok(e && !ARABIC.test(e), `en ${section}.${key}`);
      assert.ok(a && ARABIC.test(a), `ar ${section}.${key}`);
    }
    assert.match(en.errorsPage.thumbFlaggedHint, /\{when\}/);
    assert.match(ar.errorsPage.thumbFlaggedHint, /\{when\}/);
    for (const m of [en, ar]) {
      assert.match(m.videos.cropHelp, /\{image\}/);
      assert.match(m.videos.cropHelp, /\{video\}/);
      assert.ok(m.content.errors.thumbnail_shape);
    }
    assert.match(en.processing.thumbsIntro, /imported thumbnails are only flagged/);
  });
});
