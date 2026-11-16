/**
 * Videos admin → Platform settings → Credentials (Super Admin): the editor's rules, kept free of
 * server-only imports so they are unit tested. A value is typed here, sent once to admin-api, sealed
 * there and never shown again: the view says where the value in use comes from, its last four
 * characters when it was set here, and what the last test found.
 */
import { isCloudflareApiToken, type CloudflareMediaCheck, type PlatformCredentialView } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

export type CredentialState = 'ok' | 'attention' | 'untested' | 'missing';

/** The chip: missing, a failed last test, never tested, or working. */
export function credentialState(view: PlatformCredentialView): CredentialState {
  if (!view.present) return 'missing';
  if (view.unreadable || (view.test && !view.test.ok)) return 'attention';
  if (!view.test) return 'untested';
  return 'ok';
}

/** The new value's field error (null: fine). */
export function tokenError(value: string): MessageKey | null {
  if (!value.trim()) return 'platformCredentials.errorEmpty';
  return isCloudflareApiToken(value) ? null : 'platformCredentials.errorToken';
}

/** Each check in plain words: what it is, the Cloudflare permission to add, what stops working without it. */
export const CHECK_COPY: Record<CloudflareMediaCheck, { label: MessageKey; permission: MessageKey; impact: MessageKey }> = {
  token: { label: 'platformCredentials.checkToken', permission: 'platformCredentials.permToken', impact: 'platformCredentials.impactToken' },
  account_analytics: { label: 'platformCredentials.checkAccount', permission: 'platformCredentials.permAccount', impact: 'platformCredentials.impactAccount' },
  zone_analytics: { label: 'platformCredentials.checkZone', permission: 'platformCredentials.permZone', impact: 'platformCredentials.impactZone' },
  cache_purge: { label: 'platformCredentials.checkPurge', permission: 'platformCredentials.permPurge', impact: 'platformCredentials.impactPurge' },
};

/** The test's headline. */
export function testSummary(code: string): MessageKey {
  switch (code) {
    case 'ok':
      return 'platformCredentials.testOk';
    case 'invalid':
      return 'platformCredentials.testInvalid';
    case 'inactive':
      return 'platformCredentials.testInactive';
    case 'missing_permissions':
      return 'platformCredentials.testMissing';
    case 'none':
      return 'platformCredentials.testNone';
    default:
      return 'platformCredentials.testUnreachable';
  }
}

/** A failed save's message (never the server's text). */
export function saveErrorKey(status: number, error?: string): MessageKey {
  if (status === 403) return 'platformCredentials.errorForbidden';
  if (status === 400) return 'platformCredentials.errorToken';
  if (status === 503 || /unavailable/i.test(error ?? '')) return 'platformCredentials.errorUnavailable';
  return 'platformCredentials.errorFailed';
}
