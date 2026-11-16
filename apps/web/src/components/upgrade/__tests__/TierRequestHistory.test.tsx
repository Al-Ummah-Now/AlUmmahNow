/**
 * "Your requests" (TierRequestHistory) and Settings › Tier: every request with
 * its status, dates and the team's note, paged; the current tier and since
 * when; en and ar.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PublicTier, TierRequest, UpgradeOverview } from '@al-ummah/shared-types';
import { TierRequestHistory } from '../TierRequestHistory';
import SettingsTierPage from '@/app/[locale]/settings/tier/page';

let mockLang: 'en' | 'ar' = 'en';
let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/components/common/SignInPrompt', () => ({ SignInPrompt: ({ title }: { title: string }) => <p data-testid="sign-in-prompt">{title}</p> }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));
jest.mock('@/theme/upgrade.css', () => ({}), { virtual: true });
const fetchMyTierRequests = jest.fn();
const fetchUpgradeOverview = jest.fn();
jest.mock('@/lib/api/tier-requests-client', () => ({
  fetchMyTierRequests: (...a: unknown[]) => fetchMyTierRequests(...a),
  fetchUpgradeOverview: () => fetchUpgradeOverview(),
}));

const base = { description: null, descriptionAr: null, unlimited: false, pages: false, maxChannels: 1, captionMinutesMonth: 0, uploadsPerDay: 50, requestable: true };
const tiers: PublicTier[] = [
  { ...base, id: 'member', name: 'Free', nameAr: 'مجاني', uploads: false, channels: false },
  { ...base, id: 'creator', name: 'Creator', nameAr: 'صانع محتوى', uploads: true, channels: true, maxChannels: 3, uploadsPerDay: 2000 },
];
const req = (over: Partial<TierRequest>): TierRequest =>
  ({ id: 'tr_1', userId: 'u1', tierId: 'creator', tierName: 'Creator', status: 'pending', createdAt: '2026-11-14T15:00:00.000Z', decidedAt: null, declineReason: null, ...over }) as TierRequest;
const page = (items: TierRequest[], next: string | null = null) => ({ ok: true, status: 200, result: { items, next } });

describe('Your requests', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockUser = { id: 'u1' };
    jest.clearAllMocks();
  });

  it('lists every request with its status, sent and decided dates, and the team note on a decline', async () => {
    fetchMyTierRequests.mockResolvedValue(
      page([
        req({ id: 'tr_3', status: 'pending' }),
        req({ id: 'tr_2', status: 'withdrawn', createdAt: '2026-11-10T10:00:00.000Z', decidedAt: '2026-11-10T11:00:00.000Z' }),
        req({ id: 'tr_1', status: 'declined', createdAt: '2026-11-01T10:00:00.000Z', decidedAt: '2026-11-02T10:00:00.000Z', declineReason: 'Please add a channel link' }),
        req({ id: 'tr_0', status: 'approved', tierId: 'gone', tierName: 'Old tier', createdAt: '2026-10-01T10:00:00.000Z', decidedAt: '2026-10-02T10:00:00.000Z' }),
      ]),
    );
    render(<TierRequestHistory tiers={tiers} />);
    const rows = await screen.findAllByTestId('tier-request-history-row');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['pending', 'withdrawn', 'declined', 'approved']);
    expect(screen.getByRole('heading', { name: 'Your requests' })).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('tier-request-history-status')).toHaveTextContent('Pending');
    expect(within(rows[0]).queryByText(/Decided/)).toBeNull();
    expect(within(rows[2]).getByTestId('tier-request-history-status')).toHaveTextContent('Not approved');
    expect(within(rows[2]).getByText(/Decided/)).toBeInTheDocument();
    expect(within(rows[2]).getByTestId('tier-request-history-note')).toHaveTextContent('Note from the team');
    // The note as written, in its own direction
    expect(within(rows[2]).getByText('Please add a channel link')).toHaveAttribute('dir', 'auto');
    expect(within(rows[3])).toBeTruthy();
    expect(rows[3]).toHaveTextContent('Old tier');
    expect(screen.queryByTestId('tier-request-history-more')).toBeNull();
  });

  it('pages with Show more and starts over when refreshKey changes', async () => {
    fetchMyTierRequests.mockResolvedValueOnce(page([req({ id: 'a' })], 'cur1')).mockResolvedValueOnce(page([req({ id: 'b', status: 'withdrawn' })]));
    const { rerender } = render(<TierRequestHistory tiers={tiers} refreshKey={1} />);
    fireEvent.click(await screen.findByTestId('tier-request-history-more'));
    await waitFor(() => expect(screen.getAllByTestId('tier-request-history-row')).toHaveLength(2));
    expect(fetchMyTierRequests).toHaveBeenLastCalledWith('cur1');
    expect(screen.queryByTestId('tier-request-history-more')).toBeNull();
    fetchMyTierRequests.mockResolvedValueOnce(page([req({ id: 'c' })]));
    rerender(<TierRequestHistory tiers={tiers} refreshKey={2} />);
    await waitFor(() => expect(screen.getAllByTestId('tier-request-history-row')).toHaveLength(1));
    expect(fetchMyTierRequests).toHaveBeenLastCalledWith(null);
  });

  it('empty, and a load failure, say so', async () => {
    fetchMyTierRequests.mockResolvedValueOnce(page([]));
    const { unmount } = render(<TierRequestHistory tiers={tiers} />);
    expect(await screen.findByTestId('tier-request-history-empty')).toHaveTextContent('You have not requested a tier yet.');
    unmount();
    fetchMyTierRequests.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<TierRequestHistory tiers={tiers} />);
    expect(await screen.findByTestId('tier-request-history-error')).toBeInTheDocument();
  });

  it('Arabic: tier names and statuses in Arabic', async () => {
    mockLang = 'ar';
    fetchMyTierRequests.mockResolvedValue(page([req({ status: 'approved', decidedAt: '2026-11-15T10:00:00.000Z' })]));
    render(<TierRequestHistory tiers={tiers} />);
    const row = await screen.findByTestId('tier-request-history-row');
    expect(row).toHaveTextContent('صانع محتوى');
    expect(screen.getByRole('heading', { name: 'طلباتك' })).toBeInTheDocument();
  });
});

describe('Settings › Tier', () => {
  const overview = (over: Partial<UpgradeOverview> = {}) => ({
    ok: true,
    status: 200,
    result: { mode: 'request', tiers, currentTierId: 'creator', currentTierSince: '2026-11-06T09:00:00.000Z', request: null, turnstileSiteKey: null, ...over },
  });
  beforeEach(() => {
    mockLang = 'en';
    mockUser = { id: 'u1' };
    jest.clearAllMocks();
    fetchMyTierRequests.mockResolvedValue(page([]));
  });

  it('shows the current tier, since when, what it allows, a link to all tiers, and the history', async () => {
    fetchUpgradeOverview.mockResolvedValue(overview());
    render(<SettingsTierPage />);
    expect(await screen.findByTestId('settings-tier-name')).toHaveTextContent('Your tier: Creator');
    expect(screen.getByTestId('settings-tier-since')).toHaveTextContent(/^Since .*2026/);
    expect(screen.getByTestId('settings-tier-current')).toHaveTextContent('Upload up to 2,000 videos a day');
    // "See all tiers" in the card's footer (owner kept it, 2026-11-16)
    expect(screen.getByTestId('settings-tier-see-all')).toHaveAttribute('href', '/en/upgrade');
    expect(screen.getByTestId('settings-tier-see-all').closest('.upg-current-foot')).not.toBeNull();
    expect(await screen.findByTestId('tier-request-history')).toBeInTheDocument();
  });

  it('no stored date: no "Since" line; Arabic names the tier in Arabic', async () => {
    mockLang = 'ar';
    fetchUpgradeOverview.mockResolvedValue(overview({ currentTierId: 'member', currentTierSince: null }));
    render(<SettingsTierPage />);
    expect(await screen.findByTestId('settings-tier-name')).toHaveTextContent('فئتك: مجاني');
    expect(screen.queryByTestId('settings-tier-since')).toBeNull();
  });

  it('signed out: the sign-in prompt, no calls', () => {
    mockUser = null;
    render(<SettingsTierPage />);
    expect(screen.getByTestId('sign-in-prompt')).toBeInTheDocument();
    expect(fetchUpgradeOverview).not.toHaveBeenCalled();
  });
});
