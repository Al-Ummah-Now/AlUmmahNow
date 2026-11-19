import { render, screen } from '@testing-library/react';
import NotFoundPage from '../index';

let pathname = '/en/nope';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

describe('NotFoundPage (prod 2026-11-18: crashed with 500 instead of a 404)', () => {
  it('renders without a QueryClientProvider (Next renders it outside the layout for unmatched actions)', () => {
    render(<NotFoundPage />);
    expect(screen.getByTestId('not-found-page')).toHaveAttribute('dir', 'ltr');
  });

  it('an unknown two-letter first segment renders the default-locale page, not a crash', () => {
    pathname = '/qa/phpinfo.php';
    render(<NotFoundPage />);
    expect(screen.getByTestId('not-found-page')).toHaveAttribute('dir', 'ltr');
  });

  it('Arabic paths render right to left', () => {
    pathname = '/ar/nope';
    render(<NotFoundPage />);
    expect(screen.getByTestId('not-found-page')).toHaveAttribute('dir', 'rtl');
  });
});

describe('NotFoundPage: the shared error card (wiki guides/error-pages.md)', () => {
  it('one heading, the 410 words hidden until the Worker answers 410', () => {
    pathname = '/en/nope';
    render(<NotFoundPage />);
    const main = screen.getByTestId('not-found-page');
    expect(main).toHaveAttribute('data-error-status', '404');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(main.querySelector('[data-when="410"]')).toHaveAttribute('hidden');
  });

  it('offers the site search, home, and contact; Arabic code line in ٠–٩', () => {
    pathname = '/ar/nope';
    render(<NotFoundPage />);
    expect(screen.getByRole('search')).toHaveAttribute('action', '/ar/search');
    expect(screen.getByRole('link', { name: 'الصفحة الرئيسية' })).toHaveAttribute('href', '/ar');
    expect(screen.getByText('خطأ ٤٠٤')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'تواصل معنا' })).toHaveAttribute('href', '/ar/contact');
  });
});

describe('NotFoundPage answered as 410 Gone by the Worker (lib/seo/gone.ts)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__aunHttpStatus;
  });

  it('shows the 410 words, code line and title, with the 404 block hidden', () => {
    pathname = '/en/video/abc';
    (window as unknown as Record<string, unknown>).__aunHttpStatus = 410;
    render(<NotFoundPage />);
    const main = screen.getByTestId('not-found-page');
    expect(main).toHaveAttribute('data-error-status', '410');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This was removed');
    expect(screen.getByText('Error 410')).toBeInTheDocument();
    expect(main.querySelector('[data-when="404"]')).toHaveAttribute('hidden');
    expect(document.title).toBe('This was removed');
  });
});
