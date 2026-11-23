/**
 * @jest-environment node
 *
 * #302: authenticated(), getServerAuthContext(), and SessionManager distinguish
 * a real signed-out user from an infrastructure error: log and report errors
 * to the admin Errors page, never log tokens/secrets, and never silently sign
 * users out on SessionManager failures.
 */

jest.mock('@/lib/logger-server', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), trace: jest.fn() },
}));

const mockReportServerError = jest.fn<string, unknown[]>(() => 'ERR-TEST-0001');
jest.mock('@al-ummah/shared-types', () => ({
  ...jest.requireActual('@al-ummah/shared-types'),
  reportServerError: (...args: unknown[]) => mockReportServerError(...args),
}));

let cookiesImpl: () => Promise<{ get: (name: string) => { name: string; value: string } | undefined; set: jest.Mock; delete: jest.Mock }>;
jest.mock('next/headers', () => ({
  cookies: () => cookiesImpl(),
  headers: async () => new Headers(),
}));

const mockVerify = jest.fn();
jest.mock('@/lib/auth/openauth-client', () => ({
  getOpenAuthClient: () => ({ verify: (...args: unknown[]) => mockVerify(...args) }),
}));

jest.mock('@/lib/auth', () => ({
  subjects: {},
  setTokens: jest.fn(),
}));

import { authenticated } from '@/lib/actions';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { SessionManager } from '@/lib/auth/session-manager';
import { SessionInfrastructureError } from '@/lib/errors/server-report';
import { logger as mockLogger } from '@/lib/logger-server';

function jarCookies(map: Record<string, string>) {
  return async () => ({
    get: (name: string) => (name in map ? { name, value: map[name] } : undefined),
    set: jest.fn(),
    delete: jest.fn(),
  });
}

const origIngest = process.env.ERRORS_INGEST_URL;
const origKey = process.env.INTERNAL_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  process.env.ERRORS_INGEST_URL = 'https://admin.api.test/internal/errors';
  process.env.INTERNAL_API_KEY = 'internal-test-key';
  cookiesImpl = jarCookies({});
});

afterEach(() => {
  process.env.ERRORS_INGEST_URL = origIngest;
  process.env.INTERNAL_API_KEY = origKey;
});

describe('web auth error handling (#302)', () => {
  it('treats a real signed-out visitor (no cookies) cleanly with no error logs or reports', async () => {
    cookiesImpl = jarCookies({});
    expect(await authenticated()).toBe(false);
    expect(await getServerAuthContext()).toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it('logs, reports to the admin Errors page, and throws (does not silently sign out) when SessionManager fails', async () => {
    const infraErr = new Error('cookie store unavailable');
    jest.spyOn(SessionManager, 'getActiveSession').mockRejectedValue(infraErr);
    // Even if legacy cookies exist, a SessionManager failure must NOT silently fall back to them
    cookiesImpl = jarCookies({ access_token: 'legacy-secret-token' });

    await expect(authenticated()).rejects.toBeInstanceOf(SessionInfrastructureError);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    expect(mockReportServerError.mock.calls[0][0]).toBe('web');
    expect(mockVerify).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await expect(getServerAuthContext()).rejects.toBeInstanceOf(SessionInfrastructureError);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('propagates cookies() infrastructure failure out of SessionManager and reports once without double-reporting', async () => {
    cookiesImpl = async () => {
      throw new Error('runtime binding crashed');
    };

    await expect(authenticated()).rejects.toBeInstanceOf(SessionInfrastructureError);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it('logs a warning without leaking the cookie value and reports on malformed al_ummah_session JSON', async () => {
    const secretPayload = '{not-json-super-secret-token-xyz';
    cookiesImpl = jarCookies({ al_ummah_session: secretPayload, access_token: 'legacy-tok' });

    expect(await authenticated()).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((mockLogger.warn as jest.Mock).mock.calls)).not.toContain('super-secret-token-xyz');
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    // Must not fall back to legacy cookies when al_ummah_session is present
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('reports and throws when legacy token verification fails due to an infrastructure error, but returns false on invalid token', async () => {
    cookiesImpl = jarCookies({ access_token: 'legacy-jwt' });
    mockVerify.mockResolvedValue({ err: new Error('InvalidAccessTokenError') });
    expect(await authenticated()).toBe(false);
    expect(mockReportServerError).not.toHaveBeenCalled();

    // Now simulate JWKS / network outage throwing inside verify()
    mockVerify.mockRejectedValue(new TypeError('fetch failed'));
    await expect(authenticated()).rejects.toBeInstanceOf(SessionInfrastructureError);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it('rethrows Next.js control flow errors untouched without logging or reporting', async () => {
    const dynamicUsage = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
    cookiesImpl = async () => {
      throw dynamicUsage;
    };

    await expect(authenticated()).rejects.toBe(dynamicUsage);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });
});
