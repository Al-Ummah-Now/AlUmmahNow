/**
 * Header / search page box: grouped live suggestions with thumbnails,
 * picking opens the item, Enter runs the full search, recent searches.
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EN_TRANSLATIONS as en } from '@/lib/i18n/translations/en';
import type { SearchHistoryEntry } from '@/lib/search/history';
import { fetchSuggestions } from '@/lib/search/suggest-client';
import { SearchBar } from '../SearchBar';

const mockLanguage = { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => mockLanguage }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/search/suggest-client', () => ({
  ...jest.requireActual('@/lib/search/suggest-client'),
  fetchSuggestions: jest.fn(),
}));
const mockFetch = fetchSuggestions as jest.MockedFunction<typeof fetchSuggestions>;

const HISTORY: SearchHistoryEntry[] = [{ query: 'tafsir', at: 1 }, { query: 'hadith', at: 2 }];

function Harness(props: Partial<React.ComponentProps<typeof SearchBar>>) {
  const [value, setValue] = useState('');
  return (
    <SearchBar value={value} onChange={setValue} onSubmit={jest.fn()} history={HISTORY}
      onRemoveHistory={jest.fn()} onClearHistory={jest.fn()} variant="header" {...props} />
  );
}

const input = () => screen.getByTestId('header-search-input');

async function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => { jest.advanceTimersByTime(250); });
}

describe('SearchBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    push.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue([
      { type: 'channel', text: 'Seerah Studies', id: 'ch1', handle: 'seerah', subtitle: '@seerah', thumbnailUrl: 'https://img/c.jpg' },
      { type: 'video', text: 'Seerah part 1', id: 'v1', subtitle: 'Seerah Studies', thumbnailUrl: 'https://img/v.jpg' },
      { type: 'playlist', text: 'Complete Seerah', id: 'p1', subtitle: 'Seerah Studies' },
      { type: 'category', text: 'Islamic History', metadata: { category: 'islamic_history' } },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('asks for videos, channels, playlists and categories and groups them with thumbnails', async () => {
    render(<Harness />);
    await type('seer');
    expect(mockFetch).toHaveBeenCalledWith('seer', expect.objectContaining({ types: ['video', 'channel', 'playlist', 'category'] }));
    const list = screen.getByRole('listbox');
    const headings = within(list).getAllByRole('group').map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent);
    expect(headings).toEqual([en.autocomplete.groupChannels, en.autocomplete.groupVideos, en.autocomplete.groupPlaylists, en.autocomplete.groupCategories]);
    expect(screen.getAllByTestId('search-suggestion')).toHaveLength(4);
    expect(list.querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent('4 suggestions');
  });

  it('opens the picked channel, video or playlist', async () => {
    render(<Harness />);
    await type('seer');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenLastCalledWith('/en/@seerah');
    await type('seerah');
    fireEvent.click(screen.getAllByTestId('search-suggestion')[1]);
    expect(push).toHaveBeenLastCalledWith('/en/video/v1');
    await type('seerah p');
    fireEvent.click(screen.getAllByTestId('search-suggestion')[2]);
    expect(push).toHaveBeenLastCalledWith('/en/playlist/p1');
  });

  it('runs a category search for a category and the full search on Enter', async () => {
    const onSelectCategory = jest.fn();
    const onSubmit = jest.fn();
    render(<Harness onSelectCategory={onSelectCategory} onSubmit={onSubmit} />);
    await type('seer');
    fireEvent.click(screen.getAllByTestId('search-suggestion')[3]);
    expect(onSelectCategory).toHaveBeenCalledWith('islamic_history');
    await type('seerah');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('seerah');
    expect(push).not.toHaveBeenCalled();
  });

  it('limits suggestions to the channel for in-channel search', async () => {
    render(<Harness channelId="ch1" />);
    await type('seer');
    expect(mockFetch).toHaveBeenCalledWith('seer', expect.objectContaining({ types: ['video', 'playlist'], channelId: 'ch1' }));
  });

  it('shows recent searches when empty; they can be removed, cleared and searched again', () => {
    const onRemoveHistory = jest.fn();
    const onClearHistory = jest.fn();
    const onSubmit = jest.fn();
    render(<Harness onRemoveHistory={onRemoveHistory} onClearHistory={onClearHistory} onSubmit={onSubmit} />);
    fireEvent.focus(input());
    expect(screen.getAllByTestId('search-history-item').map((o) => o.textContent)).toEqual(['tafsir', 'hadith']);
    fireEvent.click(screen.getAllByTestId('search-history-remove')[1]);
    expect(onRemoveHistory).toHaveBeenCalledWith('hadith');
    fireEvent.click(screen.getByTestId('search-history-clear'));
    expect(onClearHistory).toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId('search-history-item')[0]);
    expect(onSubmit).toHaveBeenCalledWith('tafsir');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
