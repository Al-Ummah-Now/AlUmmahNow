/**
 * Route error boundaries for /en/live and /ar/live (app/{en,ar}/live/error.tsx).
 * They only render after a runtime error, which E2E cannot trigger against a
 * deployed build, so they are covered here.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveError from '../en/live/error';
import LiveErrorAR from '../ar/live/error';

jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { logger } from '@/lib/logger-client';

describe('live route error boundaries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('en: shows an accessible alert, logs the error and retries via reset()', () => {
    const reset = jest.fn();
    render(<LiveError error={Object.assign(new Error('boom'), { digest: 'd1' })} reset={reset} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-labelledby', 'error-title');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('link', { name: 'Go to home page' })).toHaveAttribute('href', '/en');
    expect(logger.error).toHaveBeenCalledWith('Live page error', expect.objectContaining({ message: 'boom', digest: 'd1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Try loading the page again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('ar: renders RTL Arabic copy, links to /ar and retries via reset()', () => {
    const reset = jest.fn();
    render(<LiveErrorAR error={new Error('boom')} reset={reset} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('حدث خطأ ما');
    expect(screen.getByRole('link', { name: 'الذهاب إلى الصفحة الرئيسية' })).toHaveAttribute('href', '/ar');
    expect(logger.error).toHaveBeenCalledWith('Live page error (AR)', expect.objectContaining({ message: 'boom' }));

    fireEvent.click(screen.getByRole('button', { name: 'حاول تحميل الصفحة مرة أخرى' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
