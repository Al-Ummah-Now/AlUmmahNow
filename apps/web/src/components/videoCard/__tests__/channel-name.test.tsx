/**
 * Cards show the channel's name in the page's language (owner, 2026-11-13: an Arabic page showed
 * "Al Ummah Now" under an Arabic title).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import VideoCardLTR from '../index';
import VideoCardRTL from '../rtl/index';
import { HomeHero } from '@/components/ThemeDemo/HomeHero';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    locale: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/library/VideoCardMenu', () => ({ VideoCardMenu: () => null }));
jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const video = {
  id: 'v1',
  title: 'Forgotten stop with the Mothers of the Believers',
  titleLocalized: { en: 'Forgotten stop with the Mothers of the Believers', ar: 'وقفة منسية مع أمهات المؤمنين' },
  channelId: 'ch-1',
  channel: 'Al Ummah Now',
  channelName: 'Al Ummah Now',
  channelNameLocalized: { en: 'Al Ummah Now', ar: 'الأمة الآن' },
  thumbnailUrl: 'https://cdn.example/v1.jpg',
  views: 27,
  dateCreated: '2026-11-12T10:00:00.000Z',
  width: 1920,
  height: 1080,
  duration: 600,
} as never;

describe('channel name on cards and the hero', () => {
  it('Arabic page: the Arabic channel name', () => {
    mockLang = 'ar';
    render(<VideoCardRTL {...(video as object)} />);
    expect(screen.getByText('الأمة الآن')).toBeInTheDocument();
    expect(screen.queryByText('Al Ummah Now')).toBeNull();
  });

  it('English page: the English channel name', () => {
    mockLang = 'en';
    render(<VideoCardLTR {...(video as object)} />);
    expect(screen.getByText('Al Ummah Now')).toBeInTheDocument();
    expect(screen.queryByText('الأمة الآن')).toBeNull();
  });

  it('the home hero follows the page language too', () => {
    mockLang = 'ar';
    render(<HomeHero video={video} />);
    expect(screen.getByText('الأمة الآن')).toBeInTheDocument();
  });
});
