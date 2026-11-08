/**
 * After a profile is created, /profile/create navigates home. The guard had
 * cached "no profile" for this user and never asked again, so the home page
 * stayed on "Redirecting to profile creation..." forever.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

let mockPathname = '/en/profile/create';
const push = jest.fn();
const checkProfileExists = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({ user: { id: 'u1', email: 'u1@example.test' }, loading: false }),
}));
jest.mock('@/lib/api/profiles-client', () => ({
  checkProfileExists: (...args: unknown[]) => checkProfileExists(...args),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: { profile: { checkingProfile: 'Checking profile...', redirectingToProfileCreation: 'Redirecting to profile creation...' } },
  }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import ProfileGuard from '../index';

describe('ProfileGuard after creating a profile', () => {
  beforeEach(() => {
    push.mockReset();
    checkProfileExists.mockReset();
    mockPathname = '/en/profile/create';
  });

  it('re-checks when leaving the create page and shows the page once the profile exists', async () => {
    checkProfileExists.mockResolvedValue(false);
    const { rerender } = render(<ProfileGuard><p>home content</p></ProfileGuard>);
    await waitFor(() => expect(checkProfileExists).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    const callsOnCreatePage = checkProfileExists.mock.calls.length;

    // Profile saved; the create page navigates home
    checkProfileExists.mockResolvedValue(true);
    mockPathname = '/en/';
    rerender(<ProfileGuard><p>home content</p></ProfileGuard>);

    expect(await screen.findByText('home content')).toBeInTheDocument();
    expect(checkProfileExists.mock.calls.length).toBeGreaterThan(callsOnCreatePage);
    expect(push).not.toHaveBeenCalledWith('/en/profile/create');
  });

  it('still sends a user without a profile to the create page', async () => {
    mockPathname = '/en/';
    checkProfileExists.mockResolvedValue(false);
    render(<ProfileGuard><p>home content</p></ProfileGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/profile/create'));
    expect(screen.queryByText('home content')).not.toBeInTheDocument();
  });
});
