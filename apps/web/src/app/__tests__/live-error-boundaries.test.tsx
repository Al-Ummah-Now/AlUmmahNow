/**
 * Route error boundaries for /en/live and /ar/live (app/{en,ar}/live/error.tsx).
 * They only render after a runtime error, which E2E cannot trigger against a
 * deployed build, so they are covered here: the friendly screen, reported to
 * the admin Errors page, never the raw message.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LiveError from '../en/live/error';
import LiveErrorAR from '../ar/live/error';

const report = jest.fn((..._a: unknown[]) => 'ERR-LIVE-0001');
jest.mock('@/lib/errors/reporter', () => ({ reportError: (...a: unknown[]) => report(...a) }));
jest.mock('@/lib/version-skew/recovery', () => ({ recoverFromVersionSkew: () => false }));

describe('live route error boundaries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('en: an accessible alert, reported, retries via reset(), no raw text', async () => {
    const reset = jest.fn();
    const error = new Error('boom secret internals');
    render(<LiveError error={error} reset={reset} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-labelledby', 'friendly-error-title');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/en');
    await waitFor(() => expect(report).toHaveBeenCalledWith(error, expect.objectContaining({ kind: 'boundary', extra: expect.objectContaining({ boundary: 'live' }) })));
    expect(document.body.textContent).not.toContain('secret internals');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('ar: RTL Arabic copy, links to /ar, retries via reset()', async () => {
    const reset = jest.fn();
    render(<LiveErrorAR error={new Error('boom')} reset={reset} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveAttribute('dir', 'rtl'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('حدث خطأ ما');
    expect(screen.getByRole('link', { name: 'الصفحة الرئيسية' })).toHaveAttribute('href', '/ar');

    fireEvent.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
