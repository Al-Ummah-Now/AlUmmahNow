/**
 * Contact us inbox: who sees it, which filters reach admin-api, and en/ar labels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canUseContactInbox } from '../src/lib/roles';
import { contactHref, parseContactFilters, CONTACT_STATUSES, CONTACT_TOPICS } from '../src/app/(protected)/contact/filters';
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
    assert.deepEqual(parseContactFilters({ status: 'new', topic: 'problem', from: '2026-11-01', to: 'yesterday', q: '  playlist ', assignee: 'me', page: '3' }), {
      status: 'new',
      topic: 'problem',
      from: '2026-11-01',
      to: undefined,
      q: 'playlist',
      assignee: 'me',
      page: 3,
    });
    assert.deepEqual(parseContactFilters({ status: 'deleted', topic: ['x'], assignee: 'bob', page: '-1' }), {
      status: undefined,
      topic: undefined,
      from: undefined,
      to: undefined,
      q: undefined,
      assignee: undefined,
      page: 1,
    });
  });

  it('builds shareable URLs', () => {
    assert.equal(contactHref({ status: 'open', q: 'a b', page: 2 }), '/contact?status=open&q=a+b&page=2');
    assert.equal(contactHref({ page: 1 }), '/contact');
  });
});

describe('contact labels', () => {
  it('has an English and an Arabic label for every status, topic and delivery state', () => {
    const groups: [string, string[]][] = [
      ['contactStatus', CONTACT_STATUSES],
      ['contactTopic', CONTACT_TOPICS],
      ['delivery', ['sent', 'failed', 'skipped', 'sunk', 'pending']],
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
  });
});
