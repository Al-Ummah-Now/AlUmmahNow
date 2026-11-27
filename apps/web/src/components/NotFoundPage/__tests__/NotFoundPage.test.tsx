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

  it('Arabic paths render right to left with Eastern Arabic digits', () => {
    pathname = '/ar/nope';
    render(<NotFoundPage />);
    const page = screen.getByTestId('not-found-page');
    expect(page).toHaveAttribute('dir', 'rtl');
    expect(page).toHaveTextContent('٤٠٤');
    expect(page).not.toHaveTextContent('404');
  });

  it('English paths render Latin digits', () => {
    pathname = '/en/nope';
    render(<NotFoundPage />);
    expect(screen.getByTestId('not-found-page')).toHaveTextContent('404');
  });
});
