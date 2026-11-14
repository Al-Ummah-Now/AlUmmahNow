import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MultiAccountProvider, useMultiAccount } from '../useMultiAccount';
import { getActiveSessionInfo } from '@/lib/actions/multi-account';

const router = { refresh: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => router,
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ lang: 'en', t: { errors: {} } }),
}));
jest.mock('@/lib/runtime-config', () => ({ getAuthUrl: () => 'https://auth.example' }));
jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/actions/multi-account', () => ({
  addUserAccount: jest.fn(),
  switchUserAccount: jest.fn(),
  removeUserAccount: jest.fn(),
  switchChannel: jest.fn(),
  reloadUserChannels: jest.fn(),
  reloadActiveProfile: jest.fn(),
  createChannelForActiveUser: jest.fn(),
  logoutCurrentAccount: jest.fn(),
  logoutAllAccounts: jest.fn(),
  getActiveSessionInfo: jest.fn(),
}));
jest.mock('@/lib/auth/auth-accounts', () => ({
  ...jest.requireActual('@/lib/auth/auth-accounts'),
  // No browser accounts on the auth server: nothing to follow
  fetchAuthAccounts: jest.fn(async () => []),
}));

const wrapper = ({ children }: { children: ReactNode }) => <MultiAccountProvider>{children}</MultiAccountProvider>;

describe('MultiAccountProvider - back from sign-in (?session_updated=true)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getActiveSessionInfo as jest.Mock).mockResolvedValue(null);
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('drops the parameter through the router (which also refreshes), never behind its back', async () => {
    window.history.replaceState(null, '', '/en/studio?tab=videos&session_updated=true#top');
    const replaceState = jest.spyOn(window.history, 'replaceState');

    renderHook(() => useMultiAccount(), { wrapper });

    // history.replaceState left the App Router's copy of the URL stale: its next commit wrote
    // ?session_updated=true back and the page never settled (local release suite, 2026-11-14)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/en/studio?tab=videos#top', { scroll: false }));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it('leaves other pages alone', async () => {
    window.history.replaceState(null, '', '/en?session=other');
    renderHook(() => useMultiAccount(), { wrapper });
    await waitFor(() => expect(getActiveSessionInfo).toHaveBeenCalled());
    expect(router.replace).not.toHaveBeenCalled();
  });
});
