/**
 * The watch page's channel row (prod v2026.11.09.5 showed only avatar + name):
 * - the subscriber count was hidden by the theme and never loaded;
 * - signed-out Subscribe went to the home page instead of sign-in;
 * - signed in, the real subscription status was never fetched.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoDetails } from '../VideoDetails';
import type { PlayerOptions } from '../interface';

let account: { user: { id: string } | null; loading: boolean } = { user: null, loading: false };
let authHeaders: Record<string, string> = {};

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => account }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    isRTL: false,
    dir: 'ltr',
  }),
}));
let mockPathname = '/en/video/v1';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/auth/client-token', () => ({ getClientAuthHeaders: async () => authHeaders }));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const options = {
  id: 'v1',
  title: 'A talk',
  channel: 'Channel One',
  channelName: 'Channel One',
  channelAvatar: '',
  channelId: 'ch1',
  userId: 'usr_owner',
  description: '',
  views: '0',
  url: '',
  autoplay: false,
  type: 'video/mp4',
  dateCreated: new Date(0),
} as PlayerOptions;

const status = (isSubscribed: boolean, subscriberCount: number) =>
  ({ ok: true, json: async () => ({ success: true, result: { channelId: 'ch1', isSubscribed, subscriberCount } }) }) as Response;

function renderRow(overrides: Partial<PlayerOptions> = {}) {
  return render(<VideoDetails title="A talk" channelName="Channel One" channelHref="/en/channels/ch1" options={{ ...options, ...overrides }} />);
}

describe('VideoDetails channel row', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    account = { user: null, loading: false };
    authHeaders = {};
    mockPathname = '/en/video/v1';
    window.history.replaceState({}, '', '/');
  });

  it('signed out: shows the real count and a Subscribe link that starts sign-in and returns to the video', async () => {
    fetchMock.mockResolvedValue(status(false, 3));
    renderRow();
    expect(screen.getByTestId('watch-channel-link')).toHaveAttribute('href', '/en/channels/ch1');
    await waitFor(() => expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('3 subscribers'));
    const subscribe = screen.getByTestId('watch-subscribe');
    expect(subscribe.tagName).toBe('A');
    expect(subscribe).toHaveTextContent('Subscribe');
    const href = new URL(subscribe.getAttribute('href')!, 'https://videos.test');
    expect(href.pathname).toBe('/api/auth/login');
    expect(href.searchParams.get('return')).toBe('/en/video/v1');
    expect(href.searchParams.get('locale')).toBe('en');
  });

  it('signed out on the legacy route (/video?vid=): sign-in returns to the same video, query kept', async () => {
    fetchMock.mockResolvedValue(status(false, 3));
    mockPathname = '/en/video';
    window.history.replaceState({}, '', '/en/video?vid=v1');
    renderRow();
    await waitFor(() => {
      const href = new URL(screen.getByTestId('watch-subscribe').getAttribute('href')!, 'https://videos.test');
      expect(href.searchParams.get('return')).toBe('/en/video?vid=v1');
    });
  });

  it('signed in: loads the status, toggles Subscribe / Subscribed and the count follows', async () => {
    account = { user: { id: 'usr_viewer' }, loading: false };
    authHeaders = { Authorization: 'Bearer t', channelId: 'ch_viewer' };
    fetchMock
      .mockResolvedValueOnce(status(false, 1))
      .mockResolvedValueOnce(status(true, 2))
      .mockResolvedValueOnce(status(false, 1));
    renderRow();
    const button = await screen.findByRole('button', { name: 'Subscribe' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('1 subscriber');

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(button).toHaveTextContent('Subscribed');
    expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('2 subscribers');
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/api/channels/ch1/subscriptions', expect.objectContaining({ method: 'POST' }));

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('1 subscriber');
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/api/channels/ch1/subscriptions', expect.objectContaining({ method: 'DELETE' }));
  });

  it('signed in without a channel: explains that subscribing needs one', async () => {
    account = { user: { id: 'usr_viewer' }, loading: false };
    authHeaders = { Authorization: 'Bearer t' };
    fetchMock.mockResolvedValue(status(false, 0));
    renderRow();
    const button = await screen.findByRole('button', { name: 'Subscribe' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('No subscribers');
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(/channel/i);
  });

  it('the owner sees the count but no Subscribe', async () => {
    account = { user: { id: 'usr_owner' }, loading: false };
    fetchMock.mockResolvedValue(status(false, 5));
    renderRow();
    await waitFor(() => expect(screen.getByTestId('watch-subscriber-count')).toHaveTextContent('5 subscribers'));
    expect(screen.queryByTestId('watch-subscribe')).toBeNull();
  });

  it('a video without a channel id (legacy import) shows the avatar and name only', () => {
    renderRow({ channelId: null });
    expect(screen.getByText('Channel One')).toBeInTheDocument();
    expect(screen.queryByTestId('watch-subscribe')).toBeNull();
    expect(screen.queryByTestId('watch-subscriber-count')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
