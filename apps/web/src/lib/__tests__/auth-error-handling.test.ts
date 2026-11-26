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
import { getServerAuthContext as getServerAuthContextV2 } from '@/lib/api/server-auth-v2';
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
  mockVerify.mockReset();
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

  it('returns signed-out quietly when OpenAuth rejects the legacy credentials', async () => {
    cookiesImpl = jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' });
    mockVerify.mockResolvedValue({ err: new Error('InvalidAccessTokenError') });

    await expect(SessionManager.getActiveSession()).resolves.toBeNull();
    await expect(authenticated()).resolves.toBe(false);
    await expect(getServerAuthContextV2()).resolves.toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it.each([
    ['authenticated', authenticated],
    ['server auth', getServerAuthContext],
    ['server auth v2 fallback', getServerAuthContextV2],
  ] as const)('reports and propagates a legacy verification outage through %s', async (_name, resolveAuth) => {
    cookiesImpl = jarCookies({ access_token: 'legacy-jwt' });
    const outage = new TypeError('JWKS fetch failed');
    mockVerify.mockRejectedValue(outage);

    await expect(resolveAuth()).rejects.toMatchObject({
      name: 'SessionInfrastructureError',
      cause: outage,
    });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it('reports and propagates verification failures during SessionManager legacy migration', async () => {
    cookiesImpl = jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' });
    const outage = new TypeError('refresh fetch failed');
    mockVerify.mockRejectedValue(outage);

    await expect(authenticated()).rejects.toMatchObject({
      name: 'SessionInfrastructureError',
      cause: outage,
    });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it('reports and propagates cookie read failures during legacy migration', async () => {
    const outage = new Error('legacy cookie store unavailable');
    cookiesImpl = jest.fn(jarCookies({}))
      .mockImplementationOnce(jarCookies({}))
      .mockRejectedValueOnce(outage);

    await expect(getServerAuthContextV2()).rejects.toMatchObject({
      name: 'SessionInfrastructureError',
      cause: outage,
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it('keeps a verified legacy session available when cookies are read-only', async () => {
    const cookieStore = await jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' })();
    cookieStore.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    });
    cookiesImpl = async () => cookieStore;
    mockVerify.mockResolvedValue({ subject: { properties: { id: 'user-1', email: 'user@example.test' } } });

    await expect(SessionManager.getActiveSession()).resolves.toMatchObject({ userId: 'user-1' });
    expect(cookieStore.set).toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it('propagates migration write failures and keeps the legacy cookies for a retry', async () => {
    const cookieStore = await jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' })();
    const outage = new Error('cookie write failed');
    cookieStore.set.mockImplementation(() => { throw outage; });
    cookiesImpl = async () => cookieStore;
    mockVerify.mockResolvedValue({ subject: { properties: { id: 'user-1', email: 'user@example.test' } } });

    await expect(SessionManager.getActiveSession()).rejects.toMatchObject({
      name: 'SessionInfrastructureError',
      cause: outage,
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it.each([
    'NEXT_REDIRECT;replace;/en;307;',
    'NEXT_HTTP_ERROR_FALLBACK;404',
    'DYNAMIC_SERVER_USAGE',
    'NEXT_PRERENDER_INTERRUPTED',
    'HANGING_PROMISE_REJECTION',
    'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  ])('rethrows %s from both legacy migration paths without reporting', async (digest) => {
    const controlFlowError = Object.assign(new Error(digest), { digest });
    mockVerify.mockRejectedValue(controlFlowError);

    cookiesImpl = jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' });
    await expect(SessionManager.getActiveSession()).rejects.toBe(controlFlowError);

    // An access-only cookie skips SessionManager migration so V2 tries authenticated().
    cookiesImpl = jarCookies({ access_token: 'legacy-jwt' });
    await expect(getServerAuthContextV2()).rejects.toBe(controlFlowError);

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it('rethrows a reported infrastructure error from both legacy migration paths without duplicate reporting', async () => {
    const outage = new SessionInfrastructureError('session store unavailable');
    mockVerify.mockRejectedValue(outage);

    cookiesImpl = jarCookies({ access_token: 'legacy-jwt', refresh_token: 'legacy-refresh' });
    await expect(SessionManager.getActiveSession()).rejects.toBe(outage);

    cookiesImpl = jarCookies({ access_token: 'legacy-jwt' });
    await expect(getServerAuthContextV2()).rejects.toBe(outage);

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it('returns signed-out quietly when cookies() is called outside a Next.js request scope', async () => {
    cookiesImpl = async () => {
      throw new Error('`cookies` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context');
    };

    expect(await authenticated()).toBe(false);
    expect(await getServerAuthContext()).toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
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
