import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      isRTL: isAr,
    };
  },
}));

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

jest.mock('@/components/VideoThumbnail/FitImage', () => ({
  FitImage: ({ alt }: { alt: string }) => <span data-testid="thumb">{alt}</span>,
}));

jest.mock('@/services/api/watch-history', () => ({
  ...jest.requireActual('@/services/api/watch-history'),
  WatchHistoryService: { list: jest.fn(), getPaused: jest.fn(), remove: jest.fn(), clearAll: jest.fn(), setPaused: jest.fn() },
}));

import { WatchHistoryService } from '@/services/api/watch-history';
import WatchHistoryPage from '..';
import WatchHistoryPageRTL from '../rtl';

const service = WatchHistoryService as jest.Mocked<typeof WatchHistoryService>;

const entry = (videoId: string) => ({
  id: `u1:${videoId}`, userId: 'u1', videoId, videoTitle: `Talk ${videoId}`, videoDuration: 600,
  channelId: 'c1', channelName: 'Noor', firstWatchedAt: '2026-11-20T10:00:00Z', lastWatchedAt: '2026-11-20T10:00:00Z', watchCount: 1,
  progress: 120, completed: false, percentageWatched: 20,
});

describe('History page: Continue watching view (?view=continue)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a'), entry('b')], total: 2, hasMore: false });
  });

  it('lists unfinished videos under "Continue watching", links back to all history and offers no Clear all', async () => {
    render(<WatchHistoryPage view="continue" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Continue watching' })).toBeInTheDocument();
    expect(service.list).toHaveBeenCalledWith({ limit: 20, completed: false });
    expect(screen.getByTestId('watch-history-page')).toHaveAttribute('data-view', 'continue');
    expect(screen.getByTestId('watch-history-view-switch')).toHaveAttribute('href', '/en/history');
    expect(screen.getByTestId('watch-history-view-switch')).toHaveTextContent('All history');
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Talk a/ })[0]).toHaveAttribute('href', expect.stringMatching(/^\/en\/video\/a/)));
    expect(screen.queryByRole('button', { name: 'Clear all history' })).toBeNull();
  });

  it('the whole history links to the Continue watching view', async () => {
    render(<WatchHistoryPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Watch History' })).toBeInTheDocument();
    expect(service.list).toHaveBeenCalledWith({ limit: 20, completed: undefined });
    expect(screen.getByTestId('watch-history-view-switch')).toHaveAttribute('href', '/en/history?view=continue');
    expect(await screen.findByRole('button', { name: 'Clear all history' })).toBeInTheDocument();
  });

  it('in Arabic, right to left', async () => {
    mockLang = 'ar';
    render(<WatchHistoryPageRTL view="continue" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'متابعة المشاهدة' })).toBeInTheDocument();
    expect(screen.getByTestId('watch-history-page')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('watch-history-view-switch')).toHaveAttribute('href', '/ar/history');
    expect(screen.getByTestId('watch-history-view-switch')).toHaveTextContent('السجل كاملًا');
  });

  it('says there is nothing to continue when the list is empty', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    render(<WatchHistoryPage view="continue" />);
    expect(await screen.findByText(/Nothing to continue/)).toBeInTheDocument();
  });
});

describe('History rows: meta separator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a')], total: 1, hasMore: false });
  });

  it('joins the Arabic meta with «،», never • (a dot reads as «٠»)', async () => {
    mockLang = 'ar';
    render(<WatchHistoryPageRTL />);
    const row = await screen.findByText(/تمت مشاهدة ٢٠٪/);
    expect(row.textContent).toContain('، ');
    expect(row.textContent).not.toMatch(/[•·]/);
  });

  it('keeps • in English', async () => {
    mockLang = 'en';
    render(<WatchHistoryPage />);
    expect((await screen.findByText(/20% watched/)).textContent).toContain(' • ');
  });
});
