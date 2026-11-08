/**
 * Search v2 filter UI (Story 29.8): type chips, filter panel and active chips
 * in English (LTR) and Arabic (RTL).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS as en } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS as ar } from '@/lib/i18n/translations/ar';
import { parseSearchParams } from '@/lib/search/url-state';
import { ActiveFilterChips, SearchFilterButton, SearchFilterPanel, SearchTypeChips } from '../SearchFilterPanel';

const mockLanguage = { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => mockLanguage }));

function useLocale(locale: 'en' | 'ar') {
  Object.assign(mockLanguage, locale === 'ar'
    ? { t: ar, lang: 'ar', locale: 'ar', isRTL: true, dir: 'rtl' }
    : { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' });
}

describe('SearchTypeChips', () => {
  afterEach(() => useLocale('en'));

  it('marks the selected type and reports changes', () => {
    const onChange = jest.fn();
    render(<SearchTypeChips state={parseSearchParams(new URLSearchParams('type=channel'))} onChange={onChange} />);
    expect(screen.getByTestId('search-type-channel')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('search-type-all')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('search-type-post'));
    expect(onChange).toHaveBeenCalledWith('post');
    fireEvent.click(screen.getByTestId('search-type-all'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('renders Arabic labels', () => {
    useLocale('ar');
    render(<SearchTypeChips state={parseSearchParams(null)} onChange={jest.fn()} />);
    expect(screen.getByTestId('search-type-video')).toHaveTextContent(ar.search.typeVideos);
    expect(screen.getByTestId('search-type-all')).toHaveTextContent('الكل');
  });
});

describe('SearchFilterPanel', () => {
  it('applies filters immediately and hides duration for non-video types', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <SearchFilterPanel state={parseSearchParams(null)} open onOpenChange={jest.fn()} onChange={onChange} onClear={jest.fn()} />,
    );
    fireEvent.click(screen.getByTestId('search-filter-duration-long'));
    expect(onChange).toHaveBeenCalledWith({ duration: 'long' });
    fireEvent.click(screen.getByTestId('search-filter-date-week'));
    expect(onChange).toHaveBeenCalledWith({ date: 'week' });
    fireEvent.change(screen.getByTestId('search-filter-category'), { target: { value: 'quran_tafsir' } });
    expect(onChange).toHaveBeenCalledWith({ category: 'quran_tafsir' });
    fireEvent.click(screen.getByTestId('search-filter-verified'));
    expect(onChange).toHaveBeenCalledWith({ verified: true });

    rerender(<SearchFilterPanel state={parseSearchParams(new URLSearchParams('type=channel'))} open onOpenChange={jest.fn()} onChange={onChange} onClear={jest.fn()} />);
    expect(screen.queryByTestId('search-filter-duration-long')).toBeNull();
  });

  it('closes on Escape and renders nothing when closed', () => {
    const onOpenChange = jest.fn();
    const { rerender } = render(<SearchFilterPanel state={parseSearchParams(null)} open onOpenChange={onOpenChange} onChange={jest.fn()} onClear={jest.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<SearchFilterPanel state={parseSearchParams(null)} open={false} onOpenChange={onOpenChange} onChange={jest.fn()} onClear={jest.fn()} />);
    expect(screen.queryByTestId('search-filter-panel')).toBeNull();
  });

  it('shows the number of active filters on the toggle', () => {
    render(<SearchFilterButton state={parseSearchParams(new URLSearchParams('date=today&verified=true&sort=date'))} open={false} onOpenChange={jest.fn()} />);
    expect(screen.getByTestId('search-filters-count')).toHaveTextContent('3');
  });
});

describe('ActiveFilterChips', () => {
  afterEach(() => useLocale('en'));

  it('lists removable chips with accessible names', () => {
    const onRemove = jest.fn();
    render(<ActiveFilterChips state={parseSearchParams(new URLSearchParams('date=today&channelId=c1'))} channelName="Seerah Studies" onRemove={onRemove} />);
    expect(screen.getByTestId('active-filter-channelId')).toHaveTextContent('In channel: Seerah Studies');
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Today' }));
    expect(onRemove).toHaveBeenCalledWith('date');
  });

  it('localises chip labels in Arabic', () => {
    useLocale('ar');
    render(<ActiveFilterChips state={parseSearchParams(new URLSearchParams('category=fiqh'))} onRemove={jest.fn()} />);
    expect(screen.getByTestId('active-filter-category')).toHaveTextContent('الفقه');
  });
});
