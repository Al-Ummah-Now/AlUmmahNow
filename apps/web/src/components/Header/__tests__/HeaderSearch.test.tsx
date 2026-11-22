/**
 * Drift guard (docs/design/NAV.md "Search"): the videos header search renders the elements of
 * packages/fanous-tokens/nav/header.js searchHtml(), the search every other app renders: the same
 * tags, contract classes, roles and popover wiring, in the same order. The videos box adds its own
 * pieces inside (the autocomplete's field wrapper, list and clear button).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { searchHtml } from '../../../../../../packages/fanous-tokens/nav/header.js';
import { EN_TRANSLATIONS as en } from '@/lib/i18n/translations/en';
import { HeaderSearch } from '../HeaderSearch';

const mockLanguage = { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => mockLanguage }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/lib/search/history', () => ({
  addSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  getSearchHistory: jest.fn(() => Promise.resolve([])),
  removeSearchHistoryEntry: jest.fn(),
  subscribeSearchHistory: jest.fn(() => () => undefined),
}));

/** The contract's skeleton: each element with a contract class, its tag, aun- classes, role and popover wiring. */
function skeleton(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return [...doc.body.querySelectorAll('[class*="aun-"]')].map((el) => {
    const classes = [...el.classList].filter((c) => c.startsWith('aun-')).join('.');
    const wiring = ['role', 'popover', 'popovertarget', 'popovertargetaction', 'type', 'data-testid']
      .map((a) => (el.hasAttribute(a) ? `${a}=${el.getAttribute(a)}` : ''))
      .filter(Boolean)
      .join(' ');
    return `${el.tagName.toLowerCase()}.${classes} ${wiring}`.trim();
  });
}

describe('the videos header search is the shared search', () => {
  const html = renderToStaticMarkup(<HeaderSearch />);

  it('renders the builder\'s elements, the videos field wrapper aside', () => {
    const ours = skeleton(html)
      // the autocomplete's wrapper around the input, and its clear button (only once there is text)
      .filter((line) => !line.startsWith('div.aun-search-field'))
      // the autocomplete makes the input a combobox
      .map((line) => line.replace(' role=combobox', '').toLowerCase());
    const contract = skeleton(searchHtml({ lang: 'en', action: '/en/search', id: 'header-search' })).map((line) => line.toLowerCase());
    expect(ours).toEqual(contract);
  });

  it('opens and closes one popover, the slot', () => {
    expect(html).toMatch(/<div[^>]*id="header-search"[^>]*popover="auto"/);
    expect((html.match(/popovertarget="header-search"/gi) ?? []).length).toBe(2);
  });
});
