import type { ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MultiAccountProvider, useMultiAccount } from '../useMultiAccount';
import { getActiveSessionInfo, switchChannel } from '@/lib/actions/multi-account';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
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

const channelOne = { id: 'ch-1', name: 'One', isMain: true };

function session(channel: typeof channelOne | null) {
  return {
    user: { id: 'u-1', email: 'u1@example.test', channel, channels: [channelOne] },
    accounts: [{ userId: 'u-1', email: 'u1@example.test', isActive: true }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const wrapper = ({ children }: { children: ReactNode }) => <MultiAccountProvider>{children}</MultiAccountProvider>;

describe('MultiAccountProvider - session reloads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reloads after a load that was already running when the channel switched', async () => {
    // The page-load read is slow and returns the session from before the switch
    const firstLoad = deferred<ReturnType<typeof session>>();
    (getActiveSessionInfo as jest.Mock).mockReturnValueOnce(firstLoad.promise).mockResolvedValue(session(null));
    (switchChannel as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMultiAccount(), { wrapper });

    let switched!: Promise<void>;
    act(() => {
      switched = result.current.switchToChannel(null);
    });
    await act(async () => {
      firstLoad.resolve(session(channelOne));
      await switched;
    });

    // The switch's own reload was not dropped: the menu shows "no channel"
    await waitFor(() => expect(result.current.user?.channel).toBeNull());
    expect(getActiveSessionInfo).toHaveBeenCalledTimes(2);
  });

  it('shares one queued reload between calls made during the same load', async () => {
    const firstLoad = deferred<ReturnType<typeof session>>();
    (getActiveSessionInfo as jest.Mock).mockReturnValueOnce(firstLoad.promise).mockResolvedValue(session(channelOne));

    const { result } = renderHook(() => useMultiAccount(), { wrapper });

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.refresh();
      b = result.current.refresh();
    });
    await act(async () => {
      firstLoad.resolve(session(channelOne));
      await Promise.all([a, b]);
    });

    expect(getActiveSessionInfo).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });
});
