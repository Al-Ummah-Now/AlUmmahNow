/**
 * A user with a profile on /profile/create is sent home. The guard did that only
 * once, inside its profile check, so when the URL came back to /profile/create
 * afterwards (seen on QA around an account switch) the page sat on
 * "Redirecting..." for good.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';

let mockPathname = '/en/profile/create';
let mockUser: { id: string; email: string } = { id: 'u1', email: 'u1@example.test' };
const push = jest.fn();
const checkProfileExists = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/lib/api/profiles-client', () => ({
  checkProfileExists: (...args: unknown[]) => checkProfileExists(...args),
}));
jest.mock('@/lib/api/profiles', () => ({
  getVideosBanStatus: async () => ({ banned: false, reason: null }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: { profile: { checkingProfile: 'Checking profile...', redirecting: 'Redirecting...', redirectingToProfileCreation: 'Redirecting to profile creation...' } },
  }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import ProfileGuard from '../index';

describe('ProfileGuard on the create page with a profile', () => {
  beforeEach(() => {
    push.mockReset();
    checkProfileExists.mockReset();
    mockPathname = '/en/profile/create';
    mockUser = { id: 'u1', email: 'u1@example.test' };
    try {
      localStorage.clear();
    } catch {
      // no storage
    }
  });

  it('sends the user home, and again when the URL comes back to the create page', async () => {
    checkProfileExists.mockResolvedValue(true);
    const { rerender } = render(<ProfileGuard><p>form</p></ProfileGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/'));
    const calls = push.mock.calls.length;

    mockPathname = '/en/';
    rerender(<ProfileGuard><p>form</p></ProfileGuard>);
    mockPathname = '/en/profile/create';
    rerender(<ProfileGuard><p>form</p></ProfileGuard>);

    await waitFor(() => expect(push.mock.calls.length).toBeGreaterThan(calls));
    expect(push).toHaveBeenLastCalledWith('/en/');
  });

  it('keeps a user without a profile on the create page', async () => {
    checkProfileExists.mockResolvedValue(false);
    render(<ProfileGuard><p>form</p></ProfileGuard>);
    await waitFor(() => expect(checkProfileExists).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(push).not.toHaveBeenCalled();
  });

  it('does not send home on the previous account\'s answer after a switch', async () => {
    checkProfileExists.mockResolvedValue(true);
    const { rerender } = render(<ProfileGuard><p>form</p></ProfileGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/'));
    push.mockReset();

    // The new account has no profile; its check has not answered yet
    let answer: (exists: boolean) => void = () => undefined;
    checkProfileExists.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    mockUser = { id: 'u2', email: 'u2@example.test' };
    rerender(<ProfileGuard><p>form</p></ProfileGuard>);
    await waitFor(() => expect(checkProfileExists).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u2' })));
    answer(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(push).not.toHaveBeenCalled();
  });
});
