/**
 * Home rails (wiki E07 "Discovery ranking"): headings follow what each list is right now, every rail is
 * a labelled region with a "See all" link, the page buttons start at the right edge, and nothing renders
 * without rails.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { HomeRails, scrollEdges } from '../HomeRails';
import type { HomeRail } from '@/lib/discovery/home-rails';

const mockLang = { lang: 'en' as 'en' | 'ar' };
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const ar = mockLang.lang === 'ar';
    return {
      t: ar ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang.lang,
      dir: ar ? 'rtl' : 'ltr',
      isRTL: ar,
    };
  },
}));
jest.mock('@/components/videoCard/index', () => ({ __esModule: true, default: (v: { id: string; title: string }) => <a data-testid="card">{v.title}</a> }));
jest.mock('@/components/videoCard/rtl/index', () => ({ __esModule: true, default: (v: { id: string; title: string }) => <a data-testid="card">{v.title}</a> }));

const videos = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}`, channelId: 'c', dateCreated: '', views: 0 })) as never[];
const rails: HomeRail[] = [
  { key: 'trending', rail: 'trending:week', info: { mode: 'new', label: 'new_this_week', signalItems: 0, computedAt: '' }, data: videos('t', 5) },
  { key: 'featured', rail: 'featured', info: { mode: 'featured', label: 'featured', signalItems: 0, computedAt: '' }, data: videos('f', 4) },
  { key: 'categories', rail: 'top', category: 'fiqh', categoryLabel: { en: 'Fiqh', ar: 'الفقه' }, info: { mode: 'top', label: 'top', signalItems: 0, computedAt: '' }, data: videos('c', 4) },
];

beforeEach(() => {
  mockLang.lang = 'en';
});

describe('HomeRails', () => {
  it('renders each rail as a labelled region headed by what it is now, with its cards and See all', () => {
    render(<HomeRails rails={rails} />);
    const regions = screen.getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('data-label'))).toEqual(['new_this_week', 'featured', 'top']);
    expect(screen.getByRole('region', { name: 'New this week' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Top in Fiqh' })).toBeTruthy();
    const first = screen.getByRole('region', { name: 'New this week' });
    expect(within(first).getAllByTestId('card')).toHaveLength(5);
    expect(within(first).getByRole('link', { name: 'See all: New this week' }).getAttribute('href')).toBe('/en/explore');
    expect(screen.queryByText('Trending this week')).toBeNull();
  });

  it('is right to left in Arabic with Arabic headings', () => {
    mockLang.lang = 'ar';
    render(<HomeRails rails={rails} />);
    expect(screen.getByRole('region', { name: 'جديد هذا الأسبوع' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'الأبرز في الفقه' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'عرض الكل: مرئيات مختارة' }).getAttribute('href')).toBe('/ar/sections');
  });

  it('starts with the previous button disabled', () => {
    render(<HomeRails rails={[rails[0]]} />);
    expect((screen.getByRole('button', { name: 'Previous videos' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders nothing without rails', () => {
    const { container } = render(<HomeRails rails={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('scrollEdges', () => {
  it('knows the start and end, left to right and right to left (negative offsets)', () => {
    expect(scrollEdges(0, 400, 1200)).toEqual({ start: true, end: false });
    expect(scrollEdges(400, 400, 1200)).toEqual({ start: false, end: false });
    expect(scrollEdges(800, 400, 1200)).toEqual({ start: false, end: true });
    expect(scrollEdges(-800, 400, 1200)).toEqual({ start: false, end: true });
    expect(scrollEdges(0, 400, 400)).toEqual({ start: true, end: true });
  });
});
