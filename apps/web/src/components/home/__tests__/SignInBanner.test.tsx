/**
 * Home page sign-in banner: signed-out visitors only, en/ar, a labelled region,
 * and a dismissal remembered for 30 days that survives blocked storage.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SignInBanner } from '../SignInBanner';
import { SIGN_IN_BANNER_STORAGE_KEY } from '@/lib/home/sign-in-banner';

const mockAuth: { user: unknown } = { user: null };
const mockLang = { lang: 'en' as 'en' | 'ar' };

jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => mockAuth }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const ar = mockLang.lang === 'ar';
    return {
      t: ar
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang.lang,
      dir: ar ? 'rtl' : 'ltr',
      isRTL: ar,
    };
  },
}));
const mockBind = jest.fn();
jest.mock('@/lib/actions', () => ({
  login: { bind: (...args: unknown[]) => { mockBind(...args); return () => undefined; } },
}));

beforeEach(() => {
  mockAuth.user = null;
  mockLang.lang = 'en';
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('SignInBanner', () => {
  it('shows signed-out visitors a labelled region with the copy, perks and a Sign in button', () => {
    render(<SignInBanner />);
    const region = screen.getByRole('region', { name: 'Join Al Ummah Now' });
    expect(region).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { name: 'Sign in to take part' })).toBeInTheDocument();
    const perks = [...screen.getByRole('list', { name: 'What you can do with an account' }).querySelectorAll('li')].map((li) => li.textContent);
    expect(perks).toEqual(['Comment', 'Like', 'Subscribe', 'Save']);
    // Upgrades live in the header button and on the Upgrade page after sign-in, never in this banner
    expect(region).not.toHaveTextContent(/creator|upload|upgrade/i);
    expect(region).not.toHaveTextContent(/follow/i);
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('type', 'submit');
    expect(signIn.closest('form')).not.toBeNull();
    // The normal sign-in action, back to this locale's home page
    expect(mockBind).toHaveBeenCalledWith(null, 'en', '/en');
    expect(screen.getByRole('button', { name: 'Hide this message' })).toBeInTheDocument();
  });

  it("shows the theme's own art (painted by the theme CSS), never a drawing of its own", () => {
    render(<SignInBanner />);
    const art = screen.getByTestId('signin-banner-art');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).toHaveClass('sib-art');
    expect(art).toBeEmptyDOMElement();
    expect(screen.getByTestId('signin-banner').querySelectorAll('svg:not(.lucide)')).toHaveLength(0);
  });

  it('renders nothing for a signed-in user', () => {
    mockAuth.user = { id: 'u1' };
    const { container } = render(<SignInBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is right to left with the Arabic copy on /ar', () => {
    mockLang.lang = 'ar';
    render(<SignInBanner />);
    const region = screen.getByRole('region', { name: 'انضم إلى الأمة الآن' });
    expect(region).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'سجل حسابك لتشارك' })).toBeInTheDocument();
    expect(region).toHaveTextContent('المرئيات');
    expect(region.querySelectorAll('.sib-perk')).toHaveLength(4);
    expect(region).not.toHaveTextContent('صانع المحتوى');
    expect(region).not.toHaveTextContent('فيديو');
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(mockBind).toHaveBeenCalledWith(null, 'ar', '/ar');
  });

  it('dismisses with the X, stores the time and stays hidden on the next render', () => {
    const { unmount } = render(<SignInBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide this message' }));
    expect(screen.queryByTestId('signin-banner')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(SIGN_IN_BANNER_STORAGE_KEY))).toBeGreaterThan(0);
    unmount();
    render(<SignInBanner />);
    expect(screen.queryByTestId('signin-banner')).not.toBeInTheDocument();
  });

  it('comes back once the dismissal is 30 days old', () => {
    localStorage.setItem(SIGN_IN_BANNER_STORAGE_KEY, String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    render(<SignInBanner />);
    expect(screen.getByTestId('signin-banner')).toBeInTheDocument();
  });

  it('still dismisses for this page view when storage is blocked', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    render(<SignInBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide this message' }));
    expect(screen.queryByTestId('signin-banner')).not.toBeInTheDocument();
  });

  it('hides when another tab dismisses it', () => {
    render(<SignInBanner />);
    act(() => {
      localStorage.setItem(SIGN_IN_BANNER_STORAGE_KEY, String(Date.now()));
      window.dispatchEvent(new StorageEvent('storage', { key: SIGN_IN_BANNER_STORAGE_KEY }));
    });
    expect(screen.queryByTestId('signin-banner')).not.toBeInTheDocument();
  });
});
