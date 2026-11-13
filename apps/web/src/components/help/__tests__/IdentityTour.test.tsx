/**
 * The identity tour (docs/features/HELP-AND-TOUR.md): offered once per account, skippable,
 * re-openable, keyboard and screen-reader friendly, never offered to automated browsers unless
 * a spec opts in.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { IdentityTour } from '../IdentityTour';
import { requestIdentityTour } from '@/lib/help/tour-events';
import { ACCOUNT_MENU_EVENT, type AccountMenuRequest } from '@/lib/navigation/account-menu-events';
import { fetchOnboarding, markIdentityTourSeen } from '@/lib/api/onboarding';

let lang: 'en' | 'ar' = 'en';
let pathname = '/en';
let user: { id: string } | null = { id: 'u1' };

jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    isRTL: lang === 'ar',
  }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user }) }));
jest.mock('@/lib/api/onboarding', () => ({ fetchOnboarding: jest.fn(), markIdentityTourSeen: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = fetchOnboarding as jest.Mock;
const markMock = markIdentityTourSeen as jest.Mock;

/** A stand-in header: account button and upload, sized so the tour can find them */
function Header() {
  return (
    <div>
      <button type="button" data-testid="nav-menu-trigger">Amina</button>
      <span role="link" data-testid="header-upload">Upload</span>
    </div>
  );
}

const menuRequests: AccountMenuRequest[] = [];
const onMenu = (e: Event) => menuRequests.push((e as CustomEvent<AccountMenuRequest>).detail);

beforeAll(() => {
  // jsdom has no layout: every element is 40x40 at 10,10
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 10, right: 50, bottom: 50, width: 40, height: 40, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
});

beforeEach(() => {
  jest.useFakeTimers();
  lang = 'en';
  pathname = '/en';
  user = { id: 'u1' };
  menuRequests.length = 0;
  fetchMock.mockReset().mockResolvedValue({ identityTour: 0 });
  markMock.mockReset().mockResolvedValue({ identityTour: 1 });
  window.sessionStorage.clear();
  window.localStorage.clear();
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  window.addEventListener(ACCOUNT_MENU_EVENT, onMenu);
});

afterEach(() => {
  window.removeEventListener(ACCOUNT_MENU_EVENT, onMenu);
  jest.useRealTimers();
});

async function offer() {
  await act(async () => { jest.advanceTimersByTime(1300); });
  await act(async () => { await Promise.resolve(); });
}

describe('IdentityTour', () => {
  it('offers itself once to an account that has not seen it, and "Not now" saves that on the account', async () => {
    render(<><Header /><IdentityTour /></>);
    await offer();
    const card = await screen.findByRole('dialog', { name: HELP_EN.tour.welcomeTitle });
    expect(card).toHaveAttribute('aria-modal', 'false');
    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.notNow }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(markMock).toHaveBeenCalledWith(1);
  });

  it('is not offered when the account has seen it, on quiet pages, or to automated browsers', async () => {
    fetchMock.mockResolvedValue({ identityTour: 1 });
    const { unmount } = render(<><Header /><IdentityTour /></>);
    await offer();
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    fetchMock.mockResolvedValue({ identityTour: 0 });
    pathname = '/en/video/abc';
    const second = render(<><Header /><IdentityTour /></>);
    await offer();
    expect(screen.queryByRole('dialog')).toBeNull();
    second.unmount();

    pathname = '/en';
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const third = render(<><Header /><IdentityTour /></>);
    await offer();
    expect(screen.queryByRole('dialog')).toBeNull();
    third.unmount();

    // The tour's own E2E spec opts back in
    window.localStorage.setItem('aun-tour-e2e', 'on');
    render(<><Header /><IdentityTour /></>);
    await offer();
    expect(await screen.findByRole('dialog', { name: HELP_EN.tour.welcomeTitle })).toBeInTheDocument();
  });

  it('walks the steps, opening the account menu on the view each one explains', async () => {
    render(<><Header /><IdentityTour /></>);
    act(() => requestIdentityTour());
    const s = HELP_EN.tour.steps;
    expect(await screen.findByRole('dialog', { name: s.account.title })).toBeInTheDocument();
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('Step 1 of 5');
    expect(screen.getByTestId('nav-menu-trigger')).toHaveAttribute('aria-describedby', 'tour-body');
    expect(screen.getByTestId('tour-live')).toHaveTextContent(`Step 1 of 5. ${s.account.title}`);
    await act(async () => { jest.advanceTimersByTime(20); });
    expect(document.activeElement).toHaveTextContent(s.account.title);

    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.next }));
    expect(screen.getByRole('dialog', { name: s.actingAs.title })).toBeInTheDocument();
    expect(menuRequests.at(-1)).toEqual({ open: true, view: 'main' });

    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.next }));
    expect(menuRequests.at(-1)).toEqual({ open: true, view: 'channels' });
    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.back }));
    expect(screen.getByRole('dialog', { name: s.actingAs.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.next }));
    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.next }));
    expect(screen.getByRole('dialog', { name: s.upload.title })).toBeInTheDocument();
    expect(menuRequests.at(-1)).toEqual({ open: false });
    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.next }));
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('Step 5 of 5');
    expect(screen.queryByRole('button', { name: HELP_EN.tour.skip })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: HELP_EN.tour.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(markMock).toHaveBeenCalledWith(1);
    expect(menuRequests.at(-1)).toEqual({ open: false });
    await act(async () => { jest.advanceTimersByTime(20); });
    expect(document.activeElement).toBe(screen.getByTestId('nav-menu-trigger'));
    expect(screen.getByTestId('nav-menu-trigger')).not.toHaveAttribute('aria-describedby');
  });

  it('Escape skips; with no Upload the upload step is left out', async () => {
    render(<><button type="button" data-testid="nav-menu-trigger">Amina</button><IdentityTour /></>);
    act(() => requestIdentityTour());
    expect(await screen.findByTestId('tour-step-count')).toHaveTextContent('Step 1 of 4');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(markMock).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('tour-live')).toHaveTextContent(HELP_EN.tour.closed);
  });

  it('speaks Arabic and mirrors', async () => {
    lang = 'ar';
    render(<><Header /><IdentityTour /></>);
    act(() => requestIdentityTour());
    const card = await screen.findByRole('dialog', { name: HELP_AR.tour.steps.account.title });
    expect(card).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('الخطوة ١ من ٥');
  });
});
