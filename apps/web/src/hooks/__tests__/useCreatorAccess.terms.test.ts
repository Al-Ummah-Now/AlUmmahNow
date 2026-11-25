/**
 * @jest-environment jsdom
 */
import { CREATOR_ERROR_CODES, CURRENT_CREATOR_TERMS_VERSION } from '@al-ummah/shared-types';

const mockFetchClientAuthInfo = jest.fn();
jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthInfo: () => mockFetchClientAuthInfo(),
}));
jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.example.test',
}));
jest.mock('@/lib/logger-client', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
let mockActiveUserId = 'u1';
jest.mock('@/hooks/useMultiAccount', () => ({
  useActiveUserId: () => mockActiveUserId,
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import {
  acceptCreatorTerms,
  markCreatorTermsRequired,
  refreshCreatorAccess,
  useCreatorAccess,
} from '../useCreatorAccess';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('useCreatorAccess terms helpers', () => {
  beforeEach(() => {
    mockActiveUserId = 'u1';
    mockFetchClientAuthInfo.mockReset().mockResolvedValue({ accessToken: 'tok-1' });
  });

  it('publishes 409 terms_version_changed currentVersion and clears terms fields on 404 feature_off', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
          via: 'tier',
          canUpload: true,
          canCreateChannel: true,
          channelsOwned: 0,
          maxChannels: 3,
          limits: null,
          usage: { hour: 0, day: 0 },
          live: { allowed: true },
          termsAccepted: false,
          termsVersion: '2026-11-24',
        },
      }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useCreatorAccess());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // 409 terms_version_changed publishes the new version locally
    const post409 = jest.fn().mockResolvedValue(
      jsonResponse({ success: false, code: CREATOR_ERROR_CODES.termsVersionChanged, currentVersion: '2026-12-01' }, 409),
    );
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
          via: 'tier',
          canUpload: true,
          canCreateChannel: true,
          channelsOwned: 0,
          maxChannels: 3,
          limits: null,
          usage: { hour: 0, day: 0 },
          live: { allowed: true },
          termsAccepted: false,
          termsVersion: '2026-12-01',
        },
      }),
    );
    let outcome: Awaited<ReturnType<typeof acceptCreatorTerms>> | undefined;
    await act(async () => {
      outcome = await acceptCreatorTerms('2026-11-24', post409);
    });
    expect(outcome).toEqual({ ok: false, code: CREATOR_ERROR_CODES.termsVersionChanged, currentVersion: '2026-12-01' });
    expect(result.current.status === 'ready' && result.current.access.termsVersion).toBe('2026-12-01');

    // 404 feature_off clears terms fields and resolves ok so open gates unblock
    const post404 = jest.fn().mockResolvedValue(jsonResponse({ success: false, code: 'feature_off' }, 404));
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
          via: 'tier',
          canUpload: true,
          canCreateChannel: true,
          channelsOwned: 0,
          maxChannels: 3,
          limits: null,
          usage: { hour: 0, day: 0 },
          live: { allowed: true },
        },
      }),
    );
    await act(async () => {
      outcome = await acceptCreatorTerms('2026-12-01', post404);
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBeUndefined();
  });

  it('drops stale in-flight focus refresh after acceptCreatorTerms succeeds, and markCreatorTermsRequired flips termsAccepted to false', async () => {
    let resolveSlowRefresh!: (res: Response) => void;
    const slowRefresh = new Promise<Response>((resolve) => {
      resolveSlowRefresh = resolve;
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: {
            tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
            via: 'tier',
            canUpload: true,
            canCreateChannel: true,
            channelsOwned: 0,
            maxChannels: 3,
            limits: null,
            usage: { hour: 0, day: 0 },
            live: { allowed: true },
            termsAccepted: false,
            termsVersion: CURRENT_CREATOR_TERMS_VERSION,
          },
        }),
      )
      .mockReturnValueOnce(slowRefresh) as unknown as typeof fetch;

    const { result } = renderHook(() => useCreatorAccess());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Start a focus refresh that is still in flight when the user accepts Terms
    let pendingRefresh!: Promise<void>;
    act(() => {
      pendingRefresh = refreshCreatorAccess();
    });

    const postOk = jest.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          termsAccepted: true,
          termsAcceptedAt: '2026-11-24T12:00:00Z',
          termsVersion: CURRENT_CREATOR_TERMS_VERSION,
        },
      }),
    );
    await act(async () => {
      const res = await acceptCreatorTerms(CURRENT_CREATOR_TERMS_VERSION, postOk);
      expect(res.ok).toBe(true);
    });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(true);

    // Late arrival of the older refresh with termsAccepted: false must NOT overwrite true
    await act(async () => {
      resolveSlowRefresh(
        jsonResponse({
          success: true,
          result: {
            tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
            via: 'tier',
            canUpload: true,
            canCreateChannel: true,
            channelsOwned: 0,
            maxChannels: 3,
            limits: null,
            usage: { hour: 0, day: 0 },
            live: { allowed: true },
            termsAccepted: false,
            termsVersion: CURRENT_CREATOR_TERMS_VERSION,
          },
        }),
      );
      await pendingRefresh;
    });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(true);

    // markCreatorTermsRequired immediately sets termsAccepted: false and keeps it sticky
    // even if a stale Worker isolate returns /api/me/creator omitting termsAccepted
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
          via: 'tier',
          canUpload: true,
          canCreateChannel: true,
          channelsOwned: 0,
          maxChannels: 3,
          limits: null,
          usage: { hour: 0, day: 0 },
          live: { allowed: true },
        },
      }),
    );
    await act(async () => {
      markCreatorTermsRequired();
      await Promise.resolve();
    });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(false);
    await act(async () => {
      await refreshCreatorAccess();
    });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(false);
  });

  it('drops late acceptCreatorTerms response if the active account switched while Agree was in flight', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          tier: { id: 'creator', name: 'Creator', unlimited: false, uploads: true, channels: true },
          via: 'tier',
          canUpload: true,
          canCreateChannel: true,
          channelsOwned: 0,
          maxChannels: 3,
          limits: null,
          usage: { hour: 0, day: 0 },
          live: { allowed: true },
          termsAccepted: false,
          termsVersion: CURRENT_CREATOR_TERMS_VERSION,
        },
      }),
    ) as unknown as typeof fetch;

    const { result, rerender } = renderHook(() => useCreatorAccess());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let resolvePost!: (res: Response) => void;
    const slowPost = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePost = resolve;
      }),
    );

    let acceptPromise!: Promise<Awaited<ReturnType<typeof acceptCreatorTerms>>>;
    act(() => {
      acceptPromise = acceptCreatorTerms(CURRENT_CREATOR_TERMS_VERSION, slowPost);
    });

    // Switch to account u2 while u1's Agree POST is still in flight
    mockActiveUserId = 'u2';
    rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(false);

    // Late 200 from u1's POST must NOT mark u2 as accepted
    let outcome: Awaited<ReturnType<typeof acceptCreatorTerms>> | undefined;
    await act(async () => {
      resolvePost(
        jsonResponse({
          success: true,
          result: {
            termsAccepted: true,
            termsAcceptedAt: '2026-11-24T12:00:00Z',
            termsVersion: CURRENT_CREATOR_TERMS_VERSION,
          },
        }),
      );
      outcome = await acceptPromise;
    });
    expect(outcome).toEqual({ ok: false, code: 'account_switched' });
    expect(result.current.status === 'ready' && result.current.access.termsAccepted).toBe(false);
  });
});
