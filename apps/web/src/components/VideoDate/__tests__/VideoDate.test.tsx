/**
 * Dates beside the views, YouTube style (owner, 2026-11-13): the line stays "6 views • 1 day ago";
 * hovering says what the date is with a verb and its exact value, screen readers hear it too.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { VideoDate, ViewCount, WatchMetaDetail, WatchMetaSummary } from '../index';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
  }),
}));

const dayAgo = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const timeOf = () => document.querySelector('time.rel-date') as HTMLElement;

describe('VideoDate', () => {
  it('shows only the relative time; the tooltip says "Published on" with the exact date (en)', () => {
    mockLang = 'en';
    render(<VideoDate video={{ dateCreated: dayAgo }} lang="en" />);
    const time = timeOf();
    expect(time.firstChild?.textContent).toBe('1 day ago');
    expect(time.getAttribute('title')).toMatch(/^Published on \w+ \d+, \d{4}, \d{2}:\d{2} (AM|PM)$/);
    // Screen readers hear the labelled date (visually hidden)
    expect(time.querySelector('.sr-only')?.textContent).toContain('Published on');
  });

  it('in Arabic: «قبل يوم واحد», tooltip «نُشر في …»', () => {
    mockLang = 'ar';
    render(<VideoDate video={{ dateCreated: dayAgo }} lang="ar" />);
    expect(timeOf().firstChild?.textContent).toBe('قبل يوم واحد');
    expect(timeOf().getAttribute('title')).toMatch(/^نُشر في /);
  });

  it('prefers publishedAt; a premiere says "Premiered on"', () => {
    mockLang = 'en';
    const twoWeeks = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
    const { unmount } = render(<VideoDate video={{ dateCreated: twoWeeks, publishedAt: dayAgo }} lang="en" />);
    expect(timeOf().firstChild?.textContent).toBe('1 day ago');
    unmount();
    mockLang = 'ar';
    render(<VideoDate video={{ dateCreated: twoWeeks, isPremiered: true, premiereDate: dayAgo }} lang="ar" />);
    expect(timeOf().getAttribute('title')).toMatch(/^عُرض لأول مرة في /);
  });

  it('live and scheduled keep their visible labels', () => {
    mockLang = 'ar';
    const { unmount } = render(<VideoDate video={{ isLive: true, dateCreated: dayAgo }} lang="ar" />);
    expect(screen.getByText('يُبث مباشرة الآن')).toBeInTheDocument();
    unmount();
    mockLang = 'en';
    const soon = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
    render(<VideoDate video={{ dateCreated: dayAgo, scheduledPublishStatus: 'scheduled', scheduledPublishDate: soon }} lang="en" />);
    expect(screen.getByText(/^Scheduled for /)).toBeInTheDocument();
  });
});

describe('views and the watch page line', () => {
  it('the compact count has the exact count as its tooltip', () => {
    render(<ViewCount count={1234} lang="ar" />);
    expect(screen.getByText(/مشاهدة/)).toHaveAttribute('title', '1,234 مشاهدة');
  });

  it('the watch summary: short line, exact count and labelled date on hover/focus and for screen readers', () => {
    mockLang = 'ar';
    render(<details><WatchMetaSummary video={{ dateCreated: dayAgo }} views={1234} lang="ar" describedById="tip" /><WatchMetaDetail video={{ dateCreated: dayAgo }} views={1234} lang="ar" /></details>);
    const summary = document.querySelector('summary')!;
    expect(summary.textContent).toContain('•');
    expect(summary).toHaveAttribute('aria-describedby', 'tip');
    expect(summary.getAttribute('data-tip')).toMatch(/^1,234 مشاهدة • نُشر في /);
    expect(document.getElementById('tip')?.textContent).toBe(summary.getAttribute('data-tip'));
    expect(screen.getByTestId('watch-published')).toHaveTextContent(/^1,234 مشاهدة • نُشر في /);
  });
});
