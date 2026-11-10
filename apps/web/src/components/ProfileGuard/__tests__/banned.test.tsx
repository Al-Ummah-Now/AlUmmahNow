/**
 * A user an admin banned on the videos platform gets a clear notice instead of
 * the profile flow: no redirect to /profile/create (creating one is refused),
 * and the create page shows the notice instead of the form.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

let mockPathname = '/en/';
const push = jest.fn();
const checkProfileExists = jest.fn();
const getVideosBanStatus = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({ user: { id: 'usr_banned', email: 'b@example.test' }, loading: false }),
}));
jest.mock('@/lib/api/profiles-client', () => ({
  checkProfileExists: (...args: unknown[]) => checkProfileExists(...args),
}));
jest.mock('@/lib/api/profiles', () => ({
  getVideosBanStatus: () => getVideosBanStatus(),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: {
      profile: {
        checkingProfile: 'Checking profile...',
        redirectingToProfileCreation: 'Redirecting to profile creation...',
        redirecting: 'Redirecting...',
        videosBannedTitle: 'You are banned on Al Ummah Now videos',
        videosBannedBody: 'You can still watch.',
        videosBannedReason: 'Reason: {reason}',
      },
    },
  }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import ProfileGuard from '../index';

describe('ProfileGuard for a user banned on videos', () => {
  beforeEach(() => {
    push.mockReset();
    checkProfileExists.mockReset().mockResolvedValue(false);
    getVideosBanStatus.mockReset().mockResolvedValue({ banned: true, reason: 'Spam' });
  });

  it('shows the banned notice above the page and does not send them to create a profile', async () => {
    mockPathname = '/en/';
    render(<ProfileGuard><p>home content</p></ProfileGuard>);
    expect(await screen.findByTestId('videos-banned-notice')).toHaveTextContent('You are banned on Al Ummah Now videos');
    expect(screen.getByText('Reason: Spam')).toBeInTheDocument();
    expect(screen.getByText('home content')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the notice instead of the create form on the create page', async () => {
    mockPathname = '/en/profile/create';
    render(<ProfileGuard><p>create form</p></ProfileGuard>);
    expect(await screen.findByTestId('videos-banned-notice')).toBeInTheDocument();
    expect(screen.queryByText('create form')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('a user who is not banned is still sent to create a profile', async () => {
    mockPathname = '/en/';
    getVideosBanStatus.mockResolvedValue({ banned: false, reason: null });
    render(<ProfileGuard><p>home content</p></ProfileGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/profile/create'));
    expect(screen.queryByTestId('videos-banned-notice')).not.toBeInTheDocument();
  });
});
