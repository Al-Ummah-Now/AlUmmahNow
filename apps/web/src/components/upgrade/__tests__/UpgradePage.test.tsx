/**
 * /upgrade (wiki AUN-TIER-REQUESTS): the beta notice, the cards with the
 * current tier lit, the request dialog (checks, Turnstile, refusals) and the
 * request's status, in en and ar.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PublicTier, TierRequest, UpgradeOverview } from '@al-ummah/shared-types';
import { UpgradePage } from '../UpgradePage';

let mockLang: 'en' | 'ar' = 'en';
let mockUser: { id: string; name?: string } | null = null;
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/theme/upgrade.css', () => ({}), { virtual: true });
const refreshCreatorAccess = jest.fn();
jest.mock('@/hooks/useCreatorAccess', () => ({ refreshCreatorAccess: () => refreshCreatorAccess() }));
const ensureHuman = jest.fn();
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman, checking: false }) }));
const fetchUpgradeOverview = jest.fn();
const submitTierRequest = jest.fn();
const withdrawTierRequest = jest.fn();
jest.mock('@/lib/api/tier-requests-client', () => ({
  fetchUpgradeOverview: () => fetchUpgradeOverview(),
  submitTierRequest: (...a: unknown[]) => submitTierRequest(...a),
  withdrawTierRequest: (...a: unknown[]) => withdrawTierRequest(...a),
}));

const base = { description: null, descriptionAr: null, unlimited: false, pages: false, maxChannels: 1, captionMinutesMonth: 0, uploadsPerDay: 50, requestable: true };
const tiers: PublicTier[] = [
  { ...base, id: 'member', name: 'Member', nameAr: 'عضو', uploads: false, channels: false },
  { ...base, id: 'creator', name: 'Creator', nameAr: 'صانع محتوى', uploads: true, channels: true, maxChannels: 3, uploadsPerDay: 2000, captionMinutesMonth: 120 },
];
const request = (over: Partial<TierRequest>): TierRequest =>
  ({ id: 'tr_1', tierId: 'creator', tierName: 'Creator', status: 'pending', createdAt: '2026-11-14T15:00:00.000Z', decidedAt: null, declineReason: null, ...over }) as TierRequest;
const overview = (over: Partial<UpgradeOverview> = {}) => ({ ok: true, status: 200, result: { tiers, currentTierId: 'member', request: null, turnstileSiteKey: null, ...over } });

describe('Upgrade page', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockUser = { id: 'u1', name: 'Yusuf' };
    jest.clearAllMocks();
  });

  it('shows the beta notice, every tier with no price, and lights the current one', async () => {
    fetchUpgradeOverview.mockResolvedValue(overview());
    render(<UpgradePage locale="en" />);
    expect(screen.getByTestId('upgrade-beta-notice')).toHaveTextContent('Paid subscriptions will open in the future');
    const member = await screen.findByTestId('tier-card-member');
    expect(member).toHaveAttribute('data-state', 'current');
    expect(member).toHaveAttribute('aria-current', 'true');
    expect(within(member).getByTestId('tier-member-current')).toHaveTextContent('Your current tier');
    expect(screen.getByTestId('tier-creator-request')).toBeEnabled();
    expect(screen.getByTestId('tier-creator-uploads')).toHaveTextContent('Upload up to 2,000 videos a day');
    expect(screen.getByTestId('upgrade-tiers').textContent).not.toMatch(/\$|€|£|\/mo/);
  });

  it('asks signed-out visitors to sign in on every card', async () => {
    mockUser = null;
    fetchUpgradeOverview.mockResolvedValue(overview({ currentTierId: null }));
    render(<UpgradePage locale="en" />);
    expect(await screen.findByTestId('tier-creator-sign-in')).toBeInTheDocument();
    expect(screen.getByTestId('tier-member-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-creator-request')).toBeNull();
  });

  it('checks the form, passes Turnstile and files the request', async () => {
    fetchUpgradeOverview.mockResolvedValueOnce(overview({ turnstileSiteKey: 'site-key' }));
    fetchUpgradeOverview.mockResolvedValueOnce(overview({ request: request({}) }));
    ensureHuman.mockResolvedValue({ ok: true, token: 'tok' });
    submitTierRequest.mockResolvedValue({ ok: true, status: 201, result: { request: request({}) } });
    render(<UpgradePage locale="en" />);
    fireEvent.click(await screen.findByTestId('tier-creator-request'));
    const dialog = await screen.findByTestId('tier-request-dialog');
    expect(screen.getByTestId('tier-request-name')).toHaveValue('Yusuf');
    fireEvent.click(within(dialog).getByTestId('tier-request-submit'));
    expect(await within(dialog).findByText('Write at least 20 characters')).toBeInTheDocument();
    expect(screen.getByTestId('tier-request-about')).toHaveAttribute('aria-invalid', 'true');
    expect(submitTierRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('tier-request-about'), { target: { value: '  I record the Friday khutbah at our masjid.  ' } });
    fireEvent.click(within(dialog).getByTestId('tier-request-submit'));
    await waitFor(() => expect(submitTierRequest).toHaveBeenCalledWith({ tierId: 'creator', name: 'Yusuf', about: 'I record the Friday khutbah at our masjid.' }, 'tok'));
    expect(ensureHuman).toHaveBeenCalledWith('tier_request', 'site-key');
    expect(await screen.findByTestId('tier-request-status')).toHaveAttribute('data-status', 'pending');
    expect(screen.queryByTestId('tier-request-dialog')).toBeNull();
    expect(screen.getByTestId('tier-creator-requested')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-notice')).not.toBeEmptyDOMElement();
  });

  it('runs the check when the server asks for it, and shows a refusal in the dialog', async () => {
    fetchUpgradeOverview.mockResolvedValue(overview());
    ensureHuman.mockResolvedValue({ ok: true, token: 'late' });
    submitTierRequest
      .mockResolvedValueOnce({ ok: false, status: 403, code: 'human_check_required', siteKey: 'k2' })
      .mockResolvedValueOnce({ ok: false, status: 409, code: 'tier_request_pending' });
    render(<UpgradePage locale="en" />);
    fireEvent.click(await screen.findByTestId('tier-creator-request'));
    fireEvent.change(await screen.findByTestId('tier-request-about'), { target: { value: 'I run a small channel for our masjid.' } });
    fireEvent.click(screen.getByTestId('tier-request-submit'));
    expect(await screen.findByTestId('tier-request-error')).toHaveTextContent(/already/i);
    expect(ensureHuman).toHaveBeenCalledWith('tier_request', 'k2');
    expect(submitTierRequest).toHaveBeenLastCalledWith(expect.anything(), 'late');
  });

  it('shows an approval with the way to upload and refreshes the header', async () => {
    fetchUpgradeOverview.mockResolvedValue(overview({ currentTierId: 'creator', request: request({ status: 'approved', decidedAt: '2026-11-14T16:00:00.000Z' }) }));
    render(<UpgradePage locale="en" />);
    expect(await screen.findByTestId('tier-request-status')).toHaveAttribute('data-status', 'approved');
    expect(screen.getByTestId('tier-request-upload')).toHaveAttribute('href', '/en/upload');
    expect(screen.getByTestId('tier-creator-current')).toBeInTheDocument();
    expect(refreshCreatorAccess).toHaveBeenCalled();
  });

  it('shows a decline with its reason and lets the user ask again, in Arabic', async () => {
    mockLang = 'ar';
    fetchUpgradeOverview.mockResolvedValue(overview({ request: request({ status: 'declined', declineReason: 'نحتاج رابط قناتك' }) }));
    render(<UpgradePage locale="ar" />);
    expect(await screen.findByTestId('tier-request-status')).toHaveAttribute('data-status', 'declined');
    expect(screen.getByTestId('tier-request-reason')).toHaveTextContent('نحتاج رابط قناتك');
    expect(screen.getByTestId('tier-card-creator')).toHaveTextContent('صانع محتوى');
    expect(screen.getByTestId('tier-creator-request')).toBeEnabled();
    expect(screen.getByTestId('tier-creator-uploads')).toHaveTextContent('٢٬٠٠٠');
  });

  it('withdraws a pending request after the in-app confirm', async () => {
    fetchUpgradeOverview.mockResolvedValueOnce(overview({ request: request({}) }));
    fetchUpgradeOverview.mockResolvedValueOnce(overview());
    withdrawTierRequest.mockResolvedValue({ ok: true, status: 200 });
    render(<UpgradePage locale="en" />);
    expect(screen.queryByTestId('tier-creator-request')).toBeNull();
    fireEvent.click(await screen.findByTestId('tier-request-withdraw'));
    const confirmDialog = await screen.findByTestId('tier-request-withdraw-dialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(withdrawTierRequest).toHaveBeenCalledWith('tr_1'));
    expect(await screen.findByTestId('tier-creator-request')).toBeEnabled();
    expect(screen.queryByTestId('tier-request-status')).toBeNull();
  });

  it('offers a retry when the tiers fail to load', async () => {
    fetchUpgradeOverview.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(overview());
    render(<UpgradePage locale="en" />);
    const error = await screen.findByTestId('upgrade-error');
    fireEvent.click(within(error).getByRole('button'));
    expect(await screen.findByTestId('tier-card-member')).toBeInTheDocument();
  });
});
