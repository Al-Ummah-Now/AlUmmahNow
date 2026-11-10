/**
 * Recently deleted (contact messages, themes, creator tiers): who sees it, the
 * route kinds, the "permanent deletion" column, and en/ar labels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRASH_KINDS, type TrashItem } from '@al-ummah/shared-types';
import { canManageTrash, parseTrashKind, TRASH_HOME, trashHref, trashRemaining, trashTitle } from '../src/lib/trash';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const ARABIC = /[؀-ۿ]/;
const NOW = new Date('2026-12-20T12:00:00.000Z');
const item = (over: Partial<TrashItem>): TrashItem => ({
  kind: 'theme',
  id: 'eid-lights',
  title: 'Eid lights',
  titleAr: 'أنوار العيد',
  deletedAt: '2026-12-10T12:00:00.000Z',
  deletedBy: 'admin-1',
  reason: null,
  purgeRequestedAt: null,
  purgeRequestedBy: null,
  purgeAfter: '2027-01-09T12:00:00.000Z',
  ...over,
});

describe('Recently deleted access (mirrors admin-api /api/trash)', () => {
  it('is for admins and super admins, never moderators', () => {
    assert.equal(canManageTrash('admin'), true);
    assert.equal(canManageTrash('Super Admin'), true);
    assert.equal(canManageTrash('moderator'), false);
    assert.equal(canManageTrash(undefined), false);
  });

  it('accepts only the three kinds and links each back to its page', () => {
    assert.deepEqual([...TRASH_KINDS], ['contact-message', 'theme', 'creator-tier']);
    assert.equal(parseTrashKind('theme'), 'theme');
    assert.equal(parseTrashKind('videos'), null);
    assert.equal(parseTrashKind(['theme']), null);
    assert.equal(trashHref('creator-tier'), '/recently-deleted/creator-tier');
    assert.deepEqual(TRASH_HOME, { 'contact-message': '/contact', theme: '/site-theme', 'creator-tier': '/creators/tiers' });
  });
});

describe('permanent deletion column', () => {
  const t = createTranslator('en');

  it('shows days left, the next cleanup when due, or queued', () => {
    assert.equal(trashRemaining(item({}), NOW, t), 'In 20 days');
    assert.equal(trashRemaining(item({ deletedAt: '2026-11-01T00:00:00.000Z' }), NOW, t), 'At the next cleanup');
    assert.equal(trashRemaining(item({ purgeRequestedAt: NOW.toISOString() }), NOW, t), 'Queued for permanent deletion');
  });

  it('uses the Arabic title in Arabic when there is one', () => {
    assert.equal(trashTitle(item({}), 'ar'), 'أنوار العيد');
    assert.equal(trashTitle(item({}), 'en'), 'Eid lights');
    assert.equal(trashTitle(item({ titleAr: undefined }), 'ar'), 'Eid lights');
  });
});

describe('Recently deleted labels', () => {
  it('has English and Arabic text for every key and kind', () => {
    for (const [key, value] of Object.entries(en.trash)) {
      if (typeof value !== 'string') continue;
      assert.ok(value.length > 0, key);
      assert.match((ar.trash as Record<string, unknown>)[key] as string, ARABIC, `ar trash.${key}`);
    }
    for (const kind of TRASH_KINDS) {
      assert.ok(en.trash.kind[kind]);
      assert.match(ar.trash.kind[kind], ARABIC);
    }
  });

  it('no longer says a delete cannot be undone', () => {
    for (const text of [en.contact.deleteConfirm, en.themeBuilder.confirmDelete, en.creators.tierDeleteBody]) {
      assert.doesNotMatch(text, /cannot be undone/);
      assert.match(text, /30 days/);
    }
  });
});
