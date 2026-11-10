/** The error screen: reported, friendly, localised, a reference; never raw text; skew goes to the recovery. */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { errorRefFromDigest } from '@al-ummah/shared-types';

const report = jest.fn((_e: unknown, opts?: { ref?: string }) => opts?.ref ?? 'ERR-CLNT-0001');
jest.mock('@/lib/errors/reporter', () => ({ reportError: (e: unknown, o: { ref?: string }) => report(e, o) }));
const recover = jest.fn(() => false);
jest.mock('@/lib/version-skew/recovery', () => ({ recoverFromVersionSkew: (...a: unknown[]) => (recover as (...x: unknown[]) => boolean)(...a) }));

import { FriendlyError } from '../FriendlyError';

const RAW = 'TypeError: Cannot read properties of undefined (reading "secret") at Foo (https://x/_next/static/chunks/a.js:1:2)';

describe('FriendlyError', () => {
  beforeEach(() => {
    report.mockClear();
    recover.mockReset().mockReturnValue(false);
    window.history.pushState({}, '', '/en/video/abc');
  });

  it('reports the error and shows a friendly screen with the reference, no raw text', async () => {
    const error = Object.assign(new Error(RAW), { name: 'TypeError' });
    render(<FriendlyError error={error} reset={() => undefined} boundary="locale" />);
    await waitFor(() => expect(screen.getByTestId('error-reference')).toHaveTextContent('ERR-CLNT-0001'));
    expect(report).toHaveBeenCalledWith(error, expect.objectContaining({ kind: 'boundary', shown: true }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong');
    expect(document.body.textContent).not.toContain('secret');
    expect(document.body.textContent).not.toContain('_next');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/en/contact?ref=ERR-CLNT-0001');
  });

  it('a server render error uses the reference derived from the digest (same as the server event)', async () => {
    const error = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '2714329351' });
    render(<FriendlyError error={error} boundary="locale" />);
    const ref = errorRefFromDigest('2714329351');
    await waitFor(() => expect(screen.getByTestId('error-reference')).toHaveTextContent(ref));
    expect(report).toHaveBeenCalledWith(error, expect.objectContaining({ ref }));
    expect(screen.getByTestId('friendly-error')).toHaveAttribute('data-kind', 'server');
  });

  it('Arabic pages get the Arabic, right-to-left screen', async () => {
    window.history.pushState({}, '', '/ar/upload');
    render(<FriendlyError error={new Error(RAW)} reset={() => undefined} boundary="upload" />);
    await waitFor(() => expect(screen.getByTestId('friendly-error')).toHaveAttribute('dir', 'rtl'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('حدث خطأ ما');
    expect(screen.getByRole('link', { name: 'تواصل معنا' })).toHaveAttribute('href', expect.stringMatching(/^\/ar\/contact/));
  });

  it('version skew goes to the skew recovery first and shows nothing of its own', async () => {
    recover.mockReturnValue(true);
    const error = new Error('Server Action "7f3a" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action');
    const { container } = render(<FriendlyError error={error} boundary="locale" />);
    await waitFor(() => expect(recover).toHaveBeenCalledWith(error, 'boundary:locale'));
    expect(container).toBeEmptyDOMElement();
    expect(report).not.toHaveBeenCalled();
  });

  it('marks errors from the release test page as test events', async () => {
    window.history.pushState({}, '', '/en/dev/error-test');
    render(<FriendlyError error={new Error('x')} boundary="locale" />);
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ test: true })));
  });
});
