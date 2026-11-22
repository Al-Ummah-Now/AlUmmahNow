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
    expect(screen.getByText(/مشاهدة/)).toHaveAttribute('title', '١٢٣٤ مشاهدة');
  });

  it('the watch summary: short line, exact count and labelled date on hover/focus and for screen readers', () => {
    mockLang = 'ar';
    render(<details><WatchMetaSummary video={{ dateCreated: dayAgo }} views={1234} lang="ar" describedById="tip" /><WatchMetaDetail video={{ dateCreated: dayAgo }} views={1234} lang="ar" /></details>);
    const summary = document.querySelector('summary')!;
    expect(summary.querySelector('[data-meta-sep]')?.textContent).toBe('، ');
    expect(summary.textContent).not.toMatch(/[•·]/);
    expect(summary).toHaveAttribute('aria-describedby', 'tip');
    expect(summary.getAttribute('data-tip')).toMatch(/^١٢٣٤ مشاهدة، نُشر في /);
    expect(document.getElementById('tip')?.textContent).toBe(summary.getAttribute('data-tip'));
    expect(screen.getByTestId('watch-published')).toHaveTextContent(/^١٢٣٤ مشاهدة، نُشر في /);
  });

  it('a video moved from YouTube says when it was first published there (en and ar)', () => {
    mockLang = 'en';
    const imported = { dateCreated: dayAgo, importedFrom: { platform: 'youtube', publishedAt: '2019-03-02T08:00:00Z' } };
    const { unmount } = render(<details><WatchMetaSummary video={imported} views={5} lang="en" describedById="tip" /><WatchMetaDetail video={imported} views={5} lang="en" /></details>);
    expect(screen.getByTestId('watch-origin-short')).toHaveTextContent('Originally on YouTube');
    expect(screen.getByTestId('watch-origin')).toHaveTextContent('Originally published on YouTube on March 2, 2019');
    expect(document.querySelector('summary')!.getAttribute('data-tip')).toContain('Originally published on YouTube on');
    unmount();
    mockLang = 'ar';
    render(<details><WatchMetaSummary video={imported} views={5} lang="ar" describedById="tip" /><WatchMetaDetail video={imported} views={5} lang="ar" /></details>);
    expect(screen.getByTestId('watch-origin')).toHaveTextContent(/^نُشر أولًا على يوتيوب في /);
  });

  it('a video brought from a social source names it, links the original, and the date follows the Arabic number rule', () => {
    mockLang = 'en';
    const imported = { dateCreated: dayAgo, importedFrom: { platform: 'mastodon', postedAt: '2026-11-10T09:00:00Z', url: 'https://social.example/@scholar/199', sourceId: 'isrc_1' } };
    const { unmount } = render(<details><WatchMetaSummary video={imported} views={5} lang="en" describedById="tip" /><WatchMetaDetail video={imported} views={5} lang="en" /></details>);
    expect(screen.getByTestId('watch-origin-short')).toHaveTextContent('Originally on Mastodon');
    expect(screen.getByTestId('watch-origin')).toHaveTextContent('Originally posted on Mastodon on November 10, 2026');
    expect(screen.getByTestId('watch-origin').querySelector('a')).toHaveAttribute('href', 'https://social.example/@scholar/199');
    unmount();
    mockLang = 'ar';
    render(<details><WatchMetaSummary video={{ ...imported, importedFrom: { ...imported.importedFrom, platform: 'rss', url: 'javascript:alert(1)' } }} views={5} lang="ar" describedById="tip" /><WatchMetaDetail video={{ ...imported, importedFrom: { ...imported.importedFrom, platform: 'rss', url: 'javascript:alert(1)' } }} views={5} lang="ar" /></details>);
    const line = screen.getByTestId('watch-origin');
    expect(line).toHaveTextContent(/^نُشر أولًا على موقعه في ١٠ نوفمبر ٢٠٢٦$/);
    expect(line.querySelector('a')).toBeNull();
  });

  it('says nothing for videos uploaded here', () => {
    mockLang = 'en';
    render(<details><WatchMetaSummary video={{ dateCreated: dayAgo }} views={5} lang="en" describedById="tip" /><WatchMetaDetail video={{ dateCreated: dayAgo, importedFrom: { platform: 'youtube', publishedAt: 'not a date' } }} views={5} lang="en" /></details>);
    expect(screen.queryByTestId('watch-origin')).toBeNull();
    expect(screen.queryByTestId('watch-origin-short')).toBeNull();
  });
});
