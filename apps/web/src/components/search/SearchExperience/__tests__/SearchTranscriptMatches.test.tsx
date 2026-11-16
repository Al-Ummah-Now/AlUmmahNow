/**
 * "Said in videos" (AUN-CAPTIONS §5.10): transcript matches open the watch page where the words are
 * said, with the words marked, in English (LTR) and Arabic (RTL).
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { SearchTranscriptMatch } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS as en } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS as ar } from '@/lib/i18n/translations/ar';
import { SearchTranscriptMatches, markPassage, passageTime } from '../SearchTranscriptMatches';

const mockLanguage = { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => mockLanguage }));

function useLocale(locale: 'en' | 'ar') {
  Object.assign(mockLanguage, locale === 'ar' ? { t: ar, lang: 'ar', locale: 'ar', isRTL: true, dir: 'rtl' } : { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' });
}

const match = (over: Partial<SearchTranscriptMatch> = {}): SearchTranscriptMatch => ({
  videoId: 'v1',
  language: 'en',
  startMs: 754_000,
  text: 'Seek help through patience and prayer',
  video: { id: 'v1', title: 'Friday reminder', titleLocalized: { ar: 'تذكير الجمعة' }, channelId: 'c1', channelName: 'Demo channel' } as unknown as SearchTranscriptMatch['video'],
  ...over,
});

describe('passage helpers', () => {
  it('formats the start time', () => {
    expect(passageTime(0)).toBe('0:00');
    expect(passageTime(754_000)).toBe('12:34');
    expect(passageTime(3_723_500)).toBe('1:02:03');
  });

  it('marks the searched words, Arabic folded the way search folds it', () => {
    expect(markPassage('Seek help through patience', 'patience').filter((p) => p.hit).map((p) => p.text)).toEqual(['patience']);
    expect(markPassage('إِنَّ اللَّهَ مَعَ الصَّابِرِينَ', 'الصابرين').filter((p) => p.hit).map((p) => p.text)).toEqual(['الصَّابِرِينَ']);
    expect(markPassage('no match here', '').some((p) => p.hit)).toBe(false);
  });
});

describe('SearchTranscriptMatches', () => {
  afterEach(() => useLocale('en'));

  it('renders nothing without matches', () => {
    const { container } = render(<SearchTranscriptMatches matches={[]} query="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links to the watch page at the passage, with the time and the marked words', () => {
    render(<SearchTranscriptMatches matches={[match()]} query="patience prayer" />);
    const section = screen.getByTestId('search-transcripts');
    expect(within(section).getByRole('heading', { name: en.search.saidInVideos })).toBeInTheDocument();
    const link = within(section).getByRole('link', { name: /Friday reminder.*At 12:34.*Demo channel.*patience/ });
    expect(link).toHaveAttribute('href', '/en/video/v1?t=754');
    expect(within(section).getByText('At 12:34', { exact: false })).toBeInTheDocument();
    expect(Array.from(section.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['patience', 'prayer']);
    expect(within(section).queryByText(/captions$/)).toBeNull();
  });

  it('in Arabic: the Arabic title, Arabic labels, and the track language when it differs', () => {
    useLocale('ar');
    render(<SearchTranscriptMatches matches={[match()]} query="patience" />);
    const section = screen.getByTestId('search-transcripts');
    expect(within(section).getByRole('heading', { name: 'قيل في المرئيات' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /تذكير الجمعة.*عند ١٢:٣٤/ })).toHaveAttribute('href', '/ar/video/v1?t=754');
    expect(within(section).getByText('من الترجمة الإنجليزية')).toBeInTheDocument();
    expect(screen.getByTestId('search-transcript-text')).toHaveAttribute('lang', 'en');
  });
});
