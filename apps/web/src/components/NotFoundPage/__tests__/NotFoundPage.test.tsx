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
