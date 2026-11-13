/**
 * A date never sits bare beside the views (owner, 2026-11-13): «6 مشاهدات • نُشر قبل يوم واحد».
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { VideoDate } from '../index';
import { RelativeDate } from '@/components/RelativeDate';

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

describe('VideoDate', () => {
  it('labels the publish date (en, ar)', () => {
    mockLang = 'en';
    const { unmount } = render(<VideoDate video={{ dateCreated: dayAgo }} lang="en" />);
    expect(screen.getByText('Published 1 day ago')).toBeInTheDocument();
    unmount();
    mockLang = 'ar';
    render(<VideoDate video={{ dateCreated: dayAgo }} lang="ar" />);
    expect(screen.getByText('نُشر قبل يوم واحد')).toBeInTheDocument();
  });

  it('prefers publishedAt over the upload date', () => {
    mockLang = 'en';
    const twoWeeks = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
    render(<VideoDate video={{ dateCreated: twoWeeks, publishedAt: dayAgo }} lang="en" />);
    expect(screen.getByText('Published 1 day ago')).toBeInTheDocument();
  });

  it('a live video says so, a scheduled one shows when', () => {
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

describe('RelativeDate labels', () => {
  it('updated (playlists) and unlabelled', () => {
    mockLang = 'ar';
    const { unmount } = render(<RelativeDate value={dayAgo} lang="ar" label="updated" />);
    expect(screen.getByText('حُدّث قبل يوم واحد')).toBeInTheDocument();
    unmount();
    render(<RelativeDate value={dayAgo} lang="ar" />);
    expect(screen.getByText('قبل يوم واحد')).toBeInTheDocument();
  });
});
