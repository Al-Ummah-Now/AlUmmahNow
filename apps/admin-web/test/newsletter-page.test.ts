/**
 * Newsletter admin page (AlUmmahNowUI#6): nav visibility (admins only, Site group), role gate, and
 * every newsletter string exists in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { canManageNewsletter } from '../src/lib/roles';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const access = (contact: boolean): NavAccess => ({ contact, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false });

/** Every leaf key path of a nested message object. */
function leaves(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('newsletter admin page', () => {
  it('is in the Site group for admins and super admins only', () => {
    const item = visibleItems(access(true)).find((i) => i.href === '/newsletter');
    assert.equal(item?.group, 'site');
    assert.ok(!visibleItems(access(false)).some((i) => i.href === '/newsletter'));
    assert.equal(canManageNewsletter('admin'), true);
    assert.equal(canManageNewsletter('super_admin'), true);
    assert.equal(canManageNewsletter('moderator'), false);
  });

  it('has every string in both languages (Arabic is not a copy of the English)', () => {
    const enKeys = leaves(en.newsletter as never).sort();
    assert.deepEqual(leaves(ar.newsletter as never).sort(), enKeys);
    assert.ok(en.nav.newsletter && ar.nav.newsletter);
    assert.equal(ar.newsletter.title, 'النشرة البريدية');
    assert.notEqual(ar.newsletter.sendBody, en.newsletter.sendBody);
    for (const k of ['not_draft', 'queue_unavailable'] as const) assert.ok(en.content.errors[k] && ar.content.errors[k], k);
    for (const s of ['confirmed', 'pending', 'unsubscribed'] as const) assert.ok(ar.newsletter.statuses[s], s);
    assert.match(en.newsletter.sendBody, /\{count\}/);
    assert.match(ar.newsletter.sendBody, /\{count\}/);
  });
});
