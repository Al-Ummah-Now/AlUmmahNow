/**
 * Status admin page (docs/status-page/README.md): public link per environment, nav visibility,
 * and every status / impact / component label exists in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INCIDENT_IMPACTS, INCIDENT_STATUSES, MAINTENANCE_STATUSES } from '@al-ummah/shared-types';
import { publicStatusUrl } from '../src/app/(protected)/status/model';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const access = (ops: boolean): NavAccess => ({ contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops });

describe('status admin page', () => {
  it('links the public page of its own environment', () => {
    assert.equal(publicStatusUrl('https://admin.api.alummahnow.net'), 'https://status.alummahnow.net');
    assert.equal(publicStatusUrl('https://admin.api.stage.alummahnow.net'), 'https://status.stage.alummahnow.net');
    assert.equal(publicStatusUrl('https://admin.api.qa.alummahnow.net'), 'https://status.qa.alummahnow.net');
    assert.equal(publicStatusUrl('http://localhost:3090'), 'http://localhost:3095');
  });

  it('is in the Operations group for admins only', () => {
    assert.ok(visibleItems(access(true)).some((i) => i.href === '/status'));
    assert.ok(!visibleItems(access(false)).some((i) => i.href === '/status'));
  });

  it('labels every status and impact in both languages', () => {
    for (const s of [...INCIDENT_STATUSES, ...MAINTENANCE_STATUSES]) {
      assert.ok(en.statusPage.statuses[s], s);
      assert.ok(ar.statusPage.statuses[s], s);
    }
    for (const i of INCIDENT_IMPACTS) {
      assert.ok(en.statusPage.impacts[i], i);
      assert.ok(ar.statusPage.impacts[i], i);
    }
    assert.equal(ar.itemSource.status, 'صفحة الحالة');
  });
});
