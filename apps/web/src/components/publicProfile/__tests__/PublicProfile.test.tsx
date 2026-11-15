/**
 * Public profile page body and settings (Story 29.5), en and ar.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PUBLIC_PROFILE_AR, PUBLIC_PROFILE_EN } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/components/VideoThumbnail', () => ({ __esModule: true, default: () => <span />, THUMBNAIL_16_9: {} }));
jest.mock('@/components/PlaylistCard', () => ({ PlaylistCard: (p: { id: string }) => <div data-testid="playlist-card">{p.id}</div> }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref'), forwardLoggedError: jest.fn() }));

const mockApi = {
  getPublicUserSubscriptions: jest.fn(),
  getPublicUserLikes: jest.fn(),
  getMyPublicProfileSettings: jest.fn(),
  updatePublicProfileSettings: jest.fn(),
  checkUserHandleAvailability: jest.fn(),
};
jest.mock('@/lib/api/public-profile', () => ({
  getPublicUserSubscriptions: (...a: unknown[]) => mockApi.getPublicUserSubscriptions(...a),
  getPublicUserLikes: (...a: unknown[]) => mockApi.getPublicUserLikes(...a),
  getMyPublicProfileSettings: (...a: unknown[]) => mockApi.getMyPublicProfileSettings(...a),
  updatePublicProfileSettings: (...a: unknown[]) => mockApi.updatePublicProfileSettings(...a),
  checkUserHandleAvailability: (...a: unknown[]) => mockApi.checkUserHandleAvailability(...a),
}));

import { PublicProfileView } from '../PublicProfileView';
import { PublicProfileSettings } from '../PublicProfileSettings';

const profile = {
  id: 'u1',
  handle: 'Sara',
  resolvedDisplayName: 'Sara',
  displayNameLocalized: { ar: 'سارة' },
  bio: 'Hello',
  dateCreated: '2026-01-15T00:00:00.000Z',
  channels: [{ id: 'c1', name: 'Noor', handle: 'noor' }],
  sections: { subscriptions: true, playlists: true, likes: true },
};
const channel = (id: string) => ({ id, name: `Channel ${id}`, handle: id }) as never;
const video = (id: string) => ({ id, title: `Video ${id}` }) as never;

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
});

describe('PublicProfileView', () => {
  it('shows the header, channels and every list the owner shows', () => {
    render(
      <PublicProfileView
        profile={profile}
        locale="en"
        isOwner={false}
        initial={{ subscriptions: { items: [channel('a')], page: 1, hasMore: false }, playlists: [{ id: 'p1' } as never], likes: { items: [video('v1')], nextCursor: null } }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Sara' })).toBeInTheDocument();
    expect(screen.getByTestId('public-profile-handle')).toHaveTextContent('@Sara');
    expect(screen.getByText('Joined January 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Channels/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('profile-channel').map((el) => el.getAttribute('href'))).toEqual(['/en/@noor', '/en/@a']);
    expect(screen.getByTestId('playlist-card')).toHaveTextContent('p1');
    expect(screen.getAllByTestId('profile-liked-video')).toHaveLength(1);
    expect(screen.queryByTestId('public-profile-owner-note')).not.toBeInTheDocument();
  });

  it('leaves out hidden lists and shows empty states', () => {
    render(
      <PublicProfileView
        profile={{ ...profile, channels: [], sections: { subscriptions: false, playlists: true, likes: false } }}
        locale="en"
        isOwner
        initial={{ subscriptions: null, playlists: [], likes: null }}
      />,
    );
    expect(screen.queryByTestId('profile-section-subscriptions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-section-likes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-section-channels')).not.toBeInTheDocument();
    expect(screen.getByText(PUBLIC_PROFILE_EN.page.emptyPlaylists)).toBeInTheDocument();
    expect(screen.getByTestId('public-profile-owner-note')).toHaveTextContent(PUBLIC_PROFILE_EN.page.ownerNote);
    expect(screen.getByRole('link', { name: PUBLIC_PROFILE_EN.page.editSettings })).toHaveAttribute('href', '/en/settings/public-profile');
  });

  it('Arabic: right to left, localized name, handle stays LTR', () => {
    render(<PublicProfileView profile={profile} locale="ar" isOwner={false} initial={{ subscriptions: { items: [], page: 1, hasMore: false }, playlists: [], likes: { items: [], nextCursor: null } }} />);
    expect(screen.getByTestId('public-profile')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1, name: 'سارة' })).toBeInTheDocument();
    expect(screen.getByTestId('public-profile-handle')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(PUBLIC_PROFILE_AR.page.emptySubscriptions)).toBeInTheDocument();
  });

  it('Show more loads the next subscriptions page and next likes', async () => {
    mockApi.getPublicUserSubscriptions.mockResolvedValue({ items: [channel('b')], page: 2, hasMore: false });
    mockApi.getPublicUserLikes.mockResolvedValue({ items: [video('v2')], nextCursor: null });
    render(
      <PublicProfileView
        profile={profile}
        locale="en"
        isOwner={false}
        initial={{ subscriptions: { items: [channel('a')], page: 1, hasMore: true }, playlists: [], likes: { items: [video('v1')], nextCursor: 'c1' } }}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-subscriptions-more'));
    await waitFor(() => expect(screen.queryByTestId('profile-subscriptions-more')).not.toBeInTheDocument());
    expect(mockApi.getPublicUserSubscriptions).toHaveBeenCalledWith('Sara', 2);
    fireEvent.click(screen.getByTestId('profile-likes-more'));
    await waitFor(() => expect(screen.getAllByTestId('profile-liked-video')).toHaveLength(2));
    expect(mockApi.getPublicUserLikes).toHaveBeenCalledWith('Sara', 'c1');
  });

  it('a failed page shows an alert and keeps the button', async () => {
    mockApi.getPublicUserLikes.mockResolvedValue(null);
    render(<PublicProfileView profile={profile} locale="en" isOwner={false} initial={{ subscriptions: null, playlists: [], likes: { items: [video('v1')], nextCursor: 'c1' } }} />);
    fireEvent.click(screen.getByTestId('profile-likes-more'));
    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => el.textContent === PUBLIC_PROFILE_EN.page.loadError)).toBe(true));
    expect(screen.getByTestId('profile-likes-more')).toBeInTheDocument();
  });
});

describe('PublicProfileSettings', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const settled = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('loads the settings, checks a new handle and saves handle and switches', async () => {
    mockApi.getMyPublicProfileSettings.mockResolvedValue({ handle: null, showSubscriptions: false, showPlaylists: true, showLikes: false });
    mockApi.checkUserHandleAvailability.mockResolvedValue({ available: true, handle: 'sara' });
    mockApi.updatePublicProfileSettings.mockResolvedValue({ ok: true, settings: { handle: 'sara', showSubscriptions: false, showPlaylists: true, showLikes: true } });
    render(<PublicProfileSettings locale="en" />);
    await settled();
    expect(screen.getByTestId('public-profile-handle-status')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.noHandle);
    expect(screen.getByTestId('public-profile-save')).toBeDisabled();

    fireEvent.change(screen.getByTestId('public-profile-handle-input'), { target: { value: '@sara' } });
    expect(screen.getByTestId('public-profile-handle-status')).toHaveAttribute('data-state', 'checking');
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    await settled();
    expect(mockApi.checkUserHandleAvailability).toHaveBeenCalledWith('sara');
    expect(screen.getByTestId('public-profile-handle-status')).toHaveTextContent('@sara is available');

    const likes = screen.getByRole('switch', { name: PUBLIC_PROFILE_EN.settings.showLikes });
    expect(likes).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(likes);
    fireEvent.click(screen.getByTestId('public-profile-save'));
    await settled();
    expect(mockApi.updatePublicProfileSettings).toHaveBeenCalledWith({ handle: 'sara', showSubscriptions: false, showPlaylists: true, showLikes: true });
    expect(screen.getByTestId('public-profile-save-result')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.saved);
    expect(screen.getByTestId('public-profile-view-link')).toHaveAttribute('href', '/en/u/@sara');
  });

  it('format problems show without a request; a taken handle blocks saving', async () => {
    mockApi.getMyPublicProfileSettings.mockResolvedValue({ handle: 'mine', showSubscriptions: false, showPlaylists: true, showLikes: false });
    mockApi.checkUserHandleAvailability.mockResolvedValue({ available: false, handle: 'taken', reason: 'taken' });
    render(<PublicProfileSettings locale="en" />);
    await settled();
    expect(screen.getByTestId('public-profile-handle-status')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.handleCurrent);
    fireEvent.change(screen.getByTestId('public-profile-handle-input'), { target: { value: 'ab' } });
    expect(screen.getByTestId('public-profile-handle-status')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.handleTooShort);
    expect(mockApi.checkUserHandleAvailability).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('public-profile-handle-input'), { target: { value: 'taken' } });
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    await settled();
    expect(screen.getByTestId('public-profile-handle-status')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.handleTaken);
    expect(screen.getByTestId('public-profile-save')).toBeDisabled();
  });

  it('removing the handle saves null; Arabic is right to left', async () => {
    mockApi.getMyPublicProfileSettings.mockResolvedValue({ handle: 'mine', showSubscriptions: false, showPlaylists: true, showLikes: false });
    mockApi.updatePublicProfileSettings.mockResolvedValue({ ok: true, settings: { handle: null, showSubscriptions: false, showPlaylists: true, showLikes: false } });
    render(<PublicProfileSettings locale="ar" />);
    await settled();
    expect(screen.getByTestId('public-profile-settings')).toHaveAttribute('dir', 'rtl');
    fireEvent.click(screen.getByRole('button', { name: PUBLIC_PROFILE_AR.settings.removeHandle }));
    fireEvent.click(screen.getByTestId('public-profile-save'));
    await settled();
    expect(mockApi.updatePublicProfileSettings).toHaveBeenCalledWith({ handle: null, showSubscriptions: false, showPlaylists: true, showLikes: false });
    expect(screen.queryByTestId('public-profile-view-link')).not.toBeInTheDocument();
  });

  it('a failed load shows an alert', async () => {
    mockApi.getMyPublicProfileSettings.mockResolvedValue(null);
    render(<PublicProfileSettings locale="en" />);
    await settled();
    expect(screen.getByTestId('public-profile-settings-error')).toHaveTextContent(PUBLIC_PROFILE_EN.settings.loadFailed);
  });
});
