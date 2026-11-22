import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    render(<WatchHistoryPage view="continue" />);
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
    render(<WatchHistoryPage />);
    const row = (await screen.findByText(/تمت مشاهدة\s٢٠٪/)).closest('p')!;
    // «،» on one line (sm and up); on phones the parts stack and the separator is hidden
    expect(row.textContent).toContain('،');
    expect(row.querySelector('.hidden.sm\\:inline')?.textContent).toBe('،');
    expect(row.textContent).toContain('مشاهدة\u00a0٢٠٪');
    expect(row.textContent).not.toMatch(/[•·]/);
  });

  it('keeps • in English', async () => {
    mockLang = 'en';
    render(<WatchHistoryPage />);
    expect((await screen.findByText(/20%\swatched/)).closest('p')!.textContent).toContain('•');
    // A short bar keeps a visible track (never lost under the thumbnail's rounded corner)
    const bar = screen.getByTestId('watch-history-progress');
    expect(bar.className).toContain('rounded-full');
    expect((bar.firstChild as HTMLElement).style.inlineSize).toBe('20%');
  });
});

describe('Continue watching: a grid of cards with remove and undo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockLang = 'en';
    service.getPaused.mockResolvedValue(false);
    service.remove.mockResolvedValue(true);
    service.list.mockResolvedValue({ entries: [entry('a'), entry('b')], total: 2, hasMore: false });
  });

  it('shows each video as a card in a grid, with Pause in the header row', async () => {
    render(<WatchHistoryPage view="continue" />);
    const grid = await screen.findByTestId('continue-grid');
    expect(within(grid).getAllByTestId('history-card')).toHaveLength(2);
    const card = within(grid).getAllByTestId('history-card')[0];
    expect(within(card).getByRole('heading', { level: 3, name: 'Talk a' })).toBeInTheDocument();
    expect(card).toHaveTextContent(/20%\swatched/);
    expect(await screen.findByTestId('watch-history-pause')).toBeInTheDocument();
    expect(screen.getByTestId('watch-history-pause').closest('header')).toBe(screen.getByRole('heading', { level: 1 }).closest('header'));
  });

  it('removes from the card at once, and Undo brings it back without deleting anything', async () => {
    jest.useFakeTimers();
    render(<WatchHistoryPage view="continue" />);
    await act(async () => { await Promise.resolve(); });
    const remove = await screen.findByRole('button', { name: 'Remove “Talk a” from watch history' });
    fireEvent.click(remove);
    expect(screen.queryByRole('heading', { level: 3, name: 'Talk a' })).toBeNull();
    expect(screen.getByTestId('history-undo-toast')).toHaveTextContent('Removed from watch history');
    fireEvent.click(screen.getByTestId('history-undo'));
    expect(screen.getByRole('heading', { level: 3, name: 'Talk a' })).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(service.remove).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('deletes for good once the undo time is over', async () => {
    jest.useFakeTimers();
    render(<WatchHistoryPage view="continue" />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove “Talk b” from watch history' }));
    await act(async () => { jest.advanceTimersByTime(6000); });
    expect(service.remove).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('history-undo-toast')).toBeNull();
    jest.useRealTimers();
  });
});

describe('The whole history: grouped by day, searchable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    service.getPaused.mockResolvedValue(false);
  });

  it('groups by day under headings, with × at the end of each row', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    service.list.mockResolvedValue({
      entries: [{ ...entry('a'), lastWatchedAt: now.toISOString() }, { ...entry('b'), lastWatchedAt: yesterday.toISOString() }],
      total: 2, hasMore: false,
    });
    render(<WatchHistoryPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
    const day = screen.getByRole('region', { name: 'Yesterday' });
    const row = within(day).getByRole('listitem');
    expect(row.lastElementChild).toHaveAttribute('aria-label', 'Remove “Talk b” from watch history');
  });

  it('searches the history from the side column and says when nothing matches', async () => {
    service.list.mockResolvedValue({ entries: [entry('a')], total: 1, hasMore: false });
    render(<WatchHistoryPage />);
    const search = await screen.findByRole('searchbox', { name: 'Search watch history' });
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false, searched: 1 });
    fireEvent.change(search, { target: { value: 'madinah' } });
    fireEvent.submit(search.closest('form')!);
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith({ limit: 20, completed: undefined, q: 'madinah' }));
    expect(await screen.findByText('No videos in your history match “madinah”.')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Manage history' })).toContainElement(search);
  });
});
