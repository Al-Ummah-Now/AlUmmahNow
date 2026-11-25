import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GUEST_REPORT_COPY } from '@/lib/report/guest-report';
import { GuestReportPage } from '../GuestReportPage';

let mockLang: 'en' | 'ar' = 'en';
let mockUser: { email: string; name?: string } | null = null;
let mockParams = new URLSearchParams();
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, lang: mockLang, isRTL: mockLang === 'ar' }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams, usePathname: () => `/${mockLang}/report` }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('@/theme/contact.css', () => ({}), { virtual: true });
const ensureHuman = jest.fn();
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman, messages: { failed: 'check failed' } }) }));
const createReport = jest.fn();
jest.mock('@/lib/api/moderation', () => ({ createReport: (...args: unknown[]) => createReport(...args) }));

const EN = GUEST_REPORT_COPY.en;

describe('the report page', () => {
  const fetchMock = jest.fn();
  const answer = (status: number, body: unknown = {}) => ({ status, json: async () => body, clone: () => ({ json: async () => body }) });
  const submit = () => fireEvent.click(screen.getByTestId('guest-report-submit'));
  beforeEach(() => {
    mockLang = 'en';
    mockUser = null;
    mockParams = new URLSearchParams('type=video&id=vid-1');
    fetchMock.mockReset();
    createReport.mockReset();
    ensureHuman.mockReset();
    ensureHuman.mockResolvedValue({ ok: true, token: 'tok' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('signed out: sends the report and asks nothing about the person', async () => {
    fetchMock.mockResolvedValue(answer(201));
    render(<GuestReportPage />);
    expect(screen.queryByTestId('guest-report-email')).toBeNull();
    expect(screen.queryByTestId('guest-report-name')).toBeNull();
    expect(screen.getByTestId('guest-report-danger')).toHaveTextContent(EN.aside.danger);
    fireEvent.click(screen.getByTestId('guest-report-reason-child_safety'));
    submit();
    expect(await screen.findByTestId('guest-report-success')).toHaveTextContent(EN.success.body);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ entityType: 'video', entityId: 'vid-1', reason: 'child_safety', details: '', website: '' });
    expect(createReport).not.toHaveBeenCalled();
  });

  it('signed in: an ordinary report of the account', async () => {
    mockUser = { email: 'me@example.org', name: 'Me' };
    createReport.mockResolvedValue({ success: true });
    render(<GuestReportPage />);
    expect(screen.getByTestId('guest-report-signed-in-notice')).toHaveTextContent(EN.signedInBody);
    expect(screen.getByTestId('guest-report-signed-in-notice')).not.toHaveTextContent('example.org');
    expect(screen.queryByTestId('guest-report-privacy-notice')).toBeNull();
    fireEvent.click(screen.getByTestId('guest-report-reason-violence'));
    fireEvent.change(screen.getByTestId('guest-report-details'), { target: { value: ' at 2:10 ' } });
    submit();
    await screen.findByTestId('guest-report-success');
    expect(createReport).toHaveBeenCalledWith({ contentType: 'video', contentId: 'vid-1', reason: 'inappropriate', description: 'at 2:10' }, undefined, 'tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate', 'duplicate', EN.errors.duplicate],
    ['auth', 'sign_in', EN.errors.signIn],
    ['rate_limited', 'rate_limited', EN.errors.rateLimited],
    ['failed', 'failed', EN.errors.generic],
  ])('signed in: %s', async (error, code, text) => {
    mockUser = { email: 'me@example.org' };
    createReport.mockResolvedValue({ success: false, error });
    render(<GuestReportPage />);
    fireEvent.click(screen.getByTestId('guest-report-reason-spam'));
    submit();
    const shown = await screen.findByTestId('guest-report-send-error');
    expect(shown).toHaveAttribute('data-error-code', code);
    expect(shown).toHaveTextContent(text);
  });

  it.each([
    [429, {}, 'rate_limited'],
    [503, {}, 'unavailable'],
    [502, {}, 'failed'],
    [400, { errors: {} }, 'failed'],
  ])('signed out: %i', async (status, body, code) => {
    fetchMock.mockResolvedValue(answer(status, body));
    render(<GuestReportPage />);
    fireEvent.click(screen.getByTestId('guest-report-reason-spam'));
    submit();
    expect(await screen.findByTestId('guest-report-send-error')).toHaveAttribute('data-error-code', code);
    if (code === 'rate_limited') expect(screen.getByTestId('guest-report-rate-limit-contact')).toHaveAttribute('href', '/en/contact');
  });

  it('runs the human check when asked and sends again with its token', async () => {
    fetchMock.mockResolvedValueOnce(answer(403, { error: 'human_check_required', siteKey: 's' })).mockResolvedValueOnce(answer(201));
    render(<GuestReportPage />);
    fireEvent.click(screen.getByTestId('guest-report-reason-spam'));
    submit();
    await screen.findByTestId('guest-report-success');
    expect(ensureHuman).toHaveBeenCalledWith('report', 's');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).turnstileToken).toBe('tok');
  });

  it('a failed check and a network error say so', async () => {
    fetchMock.mockResolvedValue(answer(403, { error: 'human_check_required', siteKey: 's' }));
    ensureHuman.mockResolvedValue({ ok: false });
    const { unmount } = render(<GuestReportPage />);
    fireEvent.click(screen.getByTestId('guest-report-reason-spam'));
    submit();
    expect(await screen.findByText('check failed')).toBeInTheDocument();
    unmount();
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<GuestReportPage />);
    fireEvent.click(screen.getByTestId('guest-report-reason-spam'));
    submit();
    expect(await screen.findByText(EN.errors.network)).toBeInTheDocument();
  });

  it('shows what is missing and sends nothing', async () => {
    mockParams = new URLSearchParams('type=unknown&id=x');
    render(<GuestReportPage />);
    expect(screen.getByTestId('guest-report-unknown-type')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('guest-report-target-input'), { target: { value: 'https://example.org/x' } });
    submit();
    expect(await screen.findByTestId('guest-report-error-target')).toHaveTextContent(EN.errors.unsupportedUrl);
    expect(screen.getByTestId('guest-report-error-reason')).toHaveTextContent(EN.errors.reasonRequired);
    fireEvent.change(screen.getByTestId('guest-report-target-input'), { target: { value: 'a b' } });
    submit();
    await waitFor(() => expect(screen.getByTestId('guest-report-error-target')).toHaveTextContent(EN.errors.invalidId));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Arabic is right to left with its own copy', () => {
    mockLang = 'ar';
    render(<GuestReportPage />);
    expect(screen.getByTestId('guest-report-page')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(GUEST_REPORT_COPY.ar.reasons.child_safety.label)).toBeInTheDocument();
    expect(screen.getByText(/٠ \/ ٤/)).toBeInTheDocument();
  });
});
