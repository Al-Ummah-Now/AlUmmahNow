/**
 * Social posting admin page (wiki AUN-SOCIAL, SOC-1): every admin role sees it in the Site group, and every
 * network, delivery status and account status the API returns has a label in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SOCIAL_NETWORKS } from '@al-ummah/shared-types';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';

const moderator: NavAccess = { contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false };

describe('social posting admin page', () => {
  it('is in the Site group for every admin role (reading is open; saving needs settings:manage)', () => {
    const item = visibleItems(moderator).find((i) => i.href === '/social');
    assert.ok(item);
    assert.equal(item.group, 'site');
    assert.equal(en.nav.socialPosting, 'Social posting');
    assert.ok(ar.nav.socialPosting);
  });

  it('labels every network and status in both languages', () => {
    for (const messages of [en, ar]) {
      for (const n of SOCIAL_NETWORKS) assert.ok(messages.socialPosting.networks[n], n);
      for (const s of ['sent', 'queued', 'sending', 'failed', 'blocked', 'cancelled'] as const) assert.ok(messages.socialPosting.statuses[s], s);
      for (const s of ['active', 'needs_reconnect', 'revoked', 'suspended'] as const) assert.ok(messages.socialPosting.accountStatuses[s], s);
    }
  });

  it('fills the spend and history templates', () => {
    const t = createTranslator('en');
    assert.equal(t('socialPosting.xSpend', { month: '2026-11', cost: '$0.20', posts: '1', cap: '$5.00' }), '2026-11: $0.20 spent on 1 posts (cap $5.00)');
    const tar = createTranslator('ar');
    assert.match(tar('socialPosting.historyCredentials', { date: 'd', network: 'X', action: 'حُفظ', actor: 'a' }), /حُفظ إعداد X/);
  });
});
