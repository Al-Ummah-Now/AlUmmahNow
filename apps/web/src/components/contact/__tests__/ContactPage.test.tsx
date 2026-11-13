import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CONTACT_AR, CONTACT_EN } from '@al-ummah/shared-types';
import { ContactPage } from '..';

let mockLang: 'en' | 'ar' = 'en';
let mockUser: { id?: string; email: string; name?: string } | null = null;
let mockProfile: Record<string, unknown> | null = null;
let mockParams = new URLSearchParams();
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams, usePathname: () => `/${mockLang}/contact` }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api/profiles-client', () => ({
  fetchProfile: jest.fn(async (_user: unknown, setProfile: (p: unknown) => void) => {
    if (!mockProfile) return false;
    setProfile(mockProfile);
    return true;
  }),
}));
jest.mock('@/theme/contact.css', () => ({}), { virtual: true });

describe('Contact us page', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    mockLang = 'en';
    mockUser = null;
    mockProfile = null;
    mockParams = new URLSearchParams();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('shows the Settings breadcrumb with a way back only when opened from Settings', () => {
    const { unmount } = render(<ContactPage />);
    expect(screen.queryByTestId('settings-breadcrumb')).toBeNull();
    unmount();
    mockParams = new URLSearchParams('from=/en/settings');
    render(<ContactPage />);
    expect(screen.getByTestId('settings-breadcrumb')).toBeInTheDocument();
    expect(screen.getByTestId('settings-back')).toHaveAttribute('href', '/en/settings');
  });

  it('shows accessible errors and sends nothing when the form is incomplete', async () => {
    render(<ContactPage />);
    fireEvent.click(screen.getByTestId('contact-submit'));
    expect(await screen.findByTestId('contact-error-summary')).toHaveTextContent(CONTACT_EN.errors.summary);
    expect(screen.getByTestId('contact-name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('contact-error-message')).toHaveTextContent(CONTACT_EN.errors.messageRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('locks the email to the signed-in account and preselects ?topic=', () => {
    mockUser = { email: 'me@account.org', name: 'Me' };
    mockParams = new URLSearchParams('topic=problem');
    render(<ContactPage />);
    expect(screen.getByTestId('contact-email')).toHaveValue('me@account.org');
    expect(screen.getByTestId('contact-email')).toHaveAttribute('readonly');
    expect(screen.getByText(CONTACT_EN.fields.emailLocked)).toBeInTheDocument();
    expect(screen.getByTestId('contact-topic-problem')).toBeChecked();
  });

  it('prefills the name with the account display name, still editable', async () => {
    mockUser = { id: 'u1', email: 'me@account.org' };
    mockProfile = { displayName: 'Amina Yusuf', firstName: 'A', lastName: 'Y' };
    render(<ContactPage />);
    await waitFor(() => expect(screen.getByTestId('contact-name')).toHaveValue('Amina Yusuf'));
    expect(screen.getByTestId('contact-name')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByTestId('contact-name'), { target: { value: 'Amina' } });
    expect(screen.getByTestId('contact-name')).toHaveValue('Amina');
  });

  it('falls back to first + last, and never to the email', async () => {
    mockUser = { id: 'u1', email: 'me@account.org' };
    mockProfile = { displayName: '', firstName: 'Amina', lastName: 'Yusuf', email: 'me@account.org' };
    const { unmount } = render(<ContactPage />);
    await waitFor(() => expect(screen.getByTestId('contact-name')).toHaveValue('Amina Yusuf'));
    unmount();
    mockProfile = { displayName: '', firstName: '', lastName: '', email: 'me@account.org' };
    mockUser = { id: 'u2', email: 'me@account.org', name: 'me@account.org' };
    render(<ContactPage />);
    await waitFor(() => expect(jest.requireMock('@/lib/api/profiles-client').fetchProfile).toHaveBeenCalled());
    expect(screen.getByTestId('contact-name')).toHaveValue('');
  });

  it('keeps the lock icon and the email on the same (LTR) side in Arabic', () => {
    mockLang = 'ar';
    mockUser = { email: 'me@account.org' };
    render(<ContactPage />);
    const input = screen.getByTestId('contact-email');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input.parentElement).toHaveAttribute('dir', 'ltr');
    expect(input.parentElement?.querySelector('.ct-input-icon')).not.toBeNull();
  });

  it('does not promise a reply in the writer’s language', () => {
    for (const c of [CONTACT_EN, CONTACT_AR]) expect(c.aside.reply).not.toMatch(/language|اللغة/);
    expect(CONTACT_EN.aside.reply).toContain('two working days');
    expect(CONTACT_AR.aside.reply).toContain('يومي عمل');
  });

  it('sends the message with the spam fields and shows the success state', async () => {
    fetchMock.mockResolvedValue({ status: 201, json: async () => ({ ok: true }) });
    render(<ContactPage />);
    fireEvent.change(screen.getByTestId('contact-name'), { target: { value: 'Amina' } });
    fireEvent.change(screen.getByTestId('contact-email'), { target: { value: 'amina@example.org' } });
    fireEvent.click(screen.getByTestId('contact-topic-account'));
    fireEvent.change(screen.getByTestId('contact-message'), { target: { value: 'I cannot sign in on my phone.' } });
    fireEvent.click(screen.getByTestId('contact-submit'));
    expect(await screen.findByTestId('contact-success')).toHaveTextContent('amina@example.org');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: 'Amina', email: 'amina@example.org', topic: 'account', locale: 'en', website: '' });
    expect(typeof body.elapsedMs).toBe('number');
  });

  it('explains the rate limit', async () => {
    fetchMock.mockResolvedValue({ status: 429, json: async () => ({ error: 'rate_limited' }) });
    render(<ContactPage />);
    fireEvent.change(screen.getByTestId('contact-name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('contact-email'), { target: { value: 'a@example.org' } });
    fireEvent.click(screen.getByTestId('contact-topic-general'));
    fireEvent.change(screen.getByTestId('contact-message'), { target: { value: 'Hello there, a question.' } });
    fireEvent.click(screen.getByTestId('contact-submit'));
    await waitFor(() => expect(screen.getByTestId('contact-send-error')).toHaveTextContent(CONTACT_EN.errors.rateLimited));
  });

  it('renders in Arabic, right to left', () => {
    mockLang = 'ar';
    render(<ContactPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CONTACT_AR.title);
    expect(screen.getByTestId('contact-page')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(CONTACT_AR.topics.partnership.label)).toBeInTheDocument();
  });

  it('has the same keys in English and Arabic', () => {
    const shape = (o: unknown): unknown => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : typeof o);
    expect(shape(CONTACT_AR)).toEqual(shape(CONTACT_EN));
  });
});
