/**
 * Help pages (/[locale]/help): the home lists every topic, searches them and starts the tour; a
 * topic page has its sections with anchors, its pictures in light and dark with their markers,
 * and "Show me" starts the tour. Arabic is right to left.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HELP_AR, HELP_EN, HELP_TOPIC_IDS } from '@al-ummah/shared-types';
import { HelpHome } from '../HelpHome';
import { HelpTopicPage } from '../HelpTopicPage';
import { TOUR_EVENT } from '@/lib/help/tour-events';

let lang: 'en' | 'ar' = 'en';
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/en/help' }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    isRTL: lang === 'ar',
  }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

function tourRequests() {
  const seen: Event[] = [];
  const listener = (e: Event) => seen.push(e);
  window.addEventListener(TOUR_EVENT, listener);
  return { seen, stop: () => window.removeEventListener(TOUR_EVENT, listener) };
}

describe('Help home', () => {
  beforeEach(() => { lang = 'en'; push.mockReset(); });

  it('lists every topic and starts the tour', () => {
    render(<HelpHome />);
    expect(screen.getByRole('heading', { level: 1, name: HELP_EN.title })).toBeInTheDocument();
    for (const id of HELP_TOPIC_IDS) {
      expect(screen.getByTestId(`help-topic-${id}`)).toHaveAttribute('href', `/en/help/${id}`);
    }
    const tour = tourRequests();
    fireEvent.click(screen.getByTestId('help-take-tour'));
    expect(tour.seen).toHaveLength(1);
    tour.stop();
  });

  it('searches every section and opens the one picked', () => {
    render(<HelpHome />);
    const input = screen.getByRole('combobox', { name: HELP_EN.searchLabel });
    fireEvent.change(input, { target: { value: 'without a channel' } });
    const list = screen.getByRole('listbox');
    fireEvent.click(within(list).getAllByRole('option')[0]);
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/en\/help\/[a-z]+(#[a-z-]+)?$/));
  });

  it('is right to left in Arabic', () => {
    lang = 'ar';
    render(<HelpHome />);
    expect(screen.getByTestId('help-home')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1, name: HELP_AR.title })).toBeInTheDocument();
  });
});

describe('Help topic page', () => {
  beforeEach(() => { lang = 'en'; });

  it('has every section with an anchor, pictures in both modes and Show me', () => {
    render(<HelpTopicPage topic="identity" />);
    for (const section of HELP_EN.topics.identity.sections) {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: section.heading })).toHaveAttribute('href', `#${section.id}`);
    }
    const menu = screen.getAllByTestId('help-figure').find((f) => f.dataset.picture === 'identity-menu')!;
    const imgs = within(menu).getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/help/identity-menu.en.desktop.light.webp', '/help/identity-menu.en.desktop.dark.webp']);
    expect(imgs[0]).toHaveAccessibleName(/account menu/);
    expect(within(menu).getAllByRole('listitem')).toHaveLength(3);
    const tour = tourRequests();
    fireEvent.click(screen.getByTestId('help-show-me'));
    expect(tour.seen).toHaveLength(1);
    tour.stop();
  });

  it('serves the Arabic pictures and text on the Arabic page', () => {
    lang = 'ar';
    render(<HelpTopicPage topic="identity" />);
    expect(screen.getByTestId('help-page-identity')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1, name: HELP_AR.topics.identity.title })).toBeInTheDocument();
    const src = screen.getAllByRole('img')[0].getAttribute('src');
    expect(src).toMatch(/\.ar\.desktop\.light\.webp$/);
  });
});
