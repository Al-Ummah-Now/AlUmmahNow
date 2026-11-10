/**
 * Requests to auth: every action, reason and status has an English and an Arabic
 * label, and the admin web's lists match the admin API's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { AUTH_REQUEST_ACTIONS, AUTH_REQUEST_REASONS, AUTH_REQUEST_STATUSES, isFinalAuthRequestStatus } from '../src/lib/api/auth-request-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The admin API's list of `name` (read as text: admin-web does not compile admin-api). */
function apiList(name: string): string[] {
  const src = readFileSync(path.join(__dirname, '../../admin-api/src/lib/authModeration.ts'), 'utf8');
  const body = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src)?.[1] ?? '';
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const ARABIC = /[؀-ۿ]/;

describe('auth requests (admin web)', () => {
  it('labels every action, reason and status in English and Arabic', () => {
    for (const [values, group] of [
      [AUTH_REQUEST_ACTIONS, 'actions'],
      [AUTH_REQUEST_REASONS, 'reasons'],
      [AUTH_REQUEST_STATUSES, 'status'],
    ] as const) {
      for (const v of values) {
        const enLabel = (en.authRequests[group] as Record<string, string>)[v];
        const arLabel = (ar.authRequests[group] as Record<string, string>)[v];
        assert.ok(enLabel, `en ${group}.${v}`);
        assert.ok(arLabel && ARABIC.test(arLabel), `ar ${group}.${v}`);
      }
    }
  });
  it('matches the admin API', () => {
    assert.deepEqual([...AUTH_REQUEST_ACTIONS], apiList('AUTH_REQUEST_ACTIONS'));
    assert.deepEqual([...AUTH_REQUEST_REASONS], apiList('AUTH_REQUEST_REASONS'));
    assert.deepEqual([...AUTH_REQUEST_STATUSES], apiList('AUTH_REQUEST_STATUSES'));
  });
  it('only rejected and actioned are final (the panel stops polling)', () => {
    assert.deepEqual(AUTH_REQUEST_STATUSES.filter(isFinalAuthRequestStatus), ['rejected', 'actioned']);
  });
});
