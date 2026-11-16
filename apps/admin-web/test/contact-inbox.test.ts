/**
 * Contact us inbox: who sees it, which filters reach admin-api, and en/ar labels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canUseContactInbox } from '../src/lib/roles';
import { activeContactView, contactHref, parseContactFilters, CONTACT_STATUSES, CONTACT_TOPICS, CONTACT_VIEWS, type ContactInboxFilters } from '../src/app/(protected)/contact/filters';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const ARABIC = /[؀-ۿ]/;

describe('contact inbox access (mirrors admin-api contact:read)', () => {
  it('is for admins and super admins, not moderators', () => {
    assert.equal(canUseContactInbox('admin'), true);
    assert.equal(canUseContactInbox('Super Admin'), true);
    assert.equal(canUseContactInbox('moderator'), false);
    assert.equal(canUseContactInbox(undefined), false);
  });
});

describe('contact filters', () => {
  it('keeps only values admin-api accepts', () => {
    assert.deepEqual(parseContactFilters({ status: 'in_progress', topic: 'problem', from: '2026-11-01', to: 'yesterday', q: '  playlist ', assignee: 'me', read: 'unread', page: '3' }), {
      status: 'in_progress',
      topic: 'problem',
      from: '2026-11-01',
      to: undefined,
      q: 'playlist',
      assignee: 'me',
      read: 'unread',
      page: 3,
    });
    assert.equal(parseContactFilters({ status: 'new' }).status, undefined, "'new' is no longer a status (read/unread is separate)");
    assert.deepEqual(parseContactFilters({ status: 'deleted', topic: ['x'], assignee: 'bob', page: '-1' }), {
      status: undefined,
      topic: undefined,
      from: undefined,
      to: undefined,
      q: undefined,
      assignee: undefined,
      read: undefined,
      page: 1,
    });
  });

  it('accepts the send_failed view (messages whose email finally failed)', () => {
    assert.equal(parseContactFilters({ status: 'send_failed' }).status, 'send_failed');
  });

  it('builds shareable URLs', () => {
    assert.equal(contactHref({ status: 'open', q: 'a b', page: 2 }), '/contact?status=open&q=a+b&page=2');
    assert.equal(contactHref({ read: 'unread' }), '/contact?read=unread');
    assert.equal(contactHref({ page: 1 }), '/contact');
  });

  it('knows which view the filters are on; search and topic keep the view', () => {
    const f = (x: Partial<ContactInboxFilters>) => ({ page: 1, ...x }) as ContactInboxFilters;
    assert.equal(activeContactView(f({})), 'all');
    assert.equal(activeContactView(f({ q: 'refund', topic: 'account' })), 'all');
    assert.equal(activeContactView(f({ read: 'unread' })), 'unread');
    assert.equal(activeContactView(f({ status: 'in_progress' })), 'in_progress');
    assert.equal(activeContactView(f({ status: 'spam' })), 'spam');
    assert.equal(activeContactView(f({ status: 'send_failed' })), 'send_failed');
    assert.equal(activeContactView(f({ status: 'closed' })), null, 'no tab for closed: the status filter shows it');
    assert.equal(activeContactView(f({ status: 'open', read: 'unread' })), null);
  });

  it('every view has an English and an Arabic label, and so do the verdicts and spam reasons', () => {
    for (const v of CONTACT_VIEWS) {
      assert.ok(en.contact.views[v.id], `en views.${v.id}`);
      assert.ok(ARABIC.test(ar.contact.views[v.id]), `ar views.${v.id}`);
    }
    for (const k of ['pass', 'fail', 'missing', 'error', 'off', 'bypass'] as const) assert.ok(ARABIC.test(ar.contact.verdicts[k]), k);
    for (const k of ['turnstile', 'content', 'admin'] as const) assert.ok(ARABIC.test(ar.contact.spamReasons[k]), k);
  });
});

describe('contact labels', () => {
  it('has an English and an Arabic label for every status, topic and delivery state', () => {
    const groups: [string, string[]][] = [
      ['contactStatus', CONTACT_STATUSES],
      ['contactTopic', CONTACT_TOPICS],
      ['delivery', ['queued', 'sent', 'failed', 'skipped', 'sunk', 'pending']],
    ];
    for (const [group, keys] of groups) {
      for (const key of keys) {
        const e = (en as unknown as Record<string, Record<string, string>>)[group][key];
        const a = (ar as unknown as Record<string, Record<string, string>>)[group][key];
        assert.ok(e, `en ${group}.${key}`);
        assert.ok(a && ARABIC.test(a), `ar ${group}.${key}`);
      }
    }
    assert.ok(ARABIC.test(ar.nav.contact));
    assert.ok(ARABIC.test(ar.contact.sendFailed) && ARABIC.test(ar.contact.retry));
    // Errors page: account erasure failures (#616)
    for (const key of ['erasureTitle', 'erasureHint', 'erasureEmpty', 'colAccount', 'colStep', 'stepAccount', 'stepContact'] as const) {
      assert.ok(en.errorsPage[key], `en errorsPage.${key}`);
      assert.ok(ARABIC.test(ar.errorsPage[key]), `ar errorsPage.${key}`);
    }
  });
});
