/**
 * The account menu's identity layer (owner decision D5, docs/features/HELP-AND-TOUR.md): the
 * section is labelled "Acting as"; with no channel active it shows the member themselves; other
 * parts of the page (the identity tour) open it on a view through
 * requestAccountMenu.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { UnifiedNavigation } from '..';
import { requestAccountMenu } from '@/lib/navigation/account-menu-events';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';
let user: Record<string, unknown> | null = null;

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, isRTL: lang === 'ar' }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    user, accounts: user ? [{ userId: 'u1', email: 'amina@test.local', displayName: 'Amina', isActive: true, channelsCount: 1 }] : [],
    loading: false, error: null, addAccount: jest.fn(), switchAccount: jest.fn(), removeAccount: jest.fn(),
    switchToChannel: jest.fn(), createChannel: jest.fn(), creatingChannel: false, reloadChannels: jest.fn(),
    logout: jest.fn(), logoutAll: jest.fn(),
  }),
}));
let mockCreatorAccess: Record<string, unknown> = { status: 'loading' };
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => mockCreatorAccess,
  mayCreateChannel: () => false,
  refreshCreatorAccess: jest.fn(),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { roles: [] } }) }));
jest.mock('@/lib/api/profiles-client', () => ({ fetchProfile: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({
  getAuthProfileUrl: () => 'https://profile.test', getAuthUrl: () => 'https://auth.test', getCmsUrl: () => 'https://cms.test', getWwwUrl: () => 'https://www.test',
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
let inviteCount = 0;
jest.mock('@/lib/channels/invites-count', () => ({ useChannelInviteCount: () => inviteCount, CHANNEL_INVITES_CHANGED: 'x' }));

const channel = { id: 'ch1', name: 'Community Corner', userId: 'u1', isMain: true, role: 'owner' };

describe('account menu: Acting as', () => {
  beforeEach(() => { lang = 'en'; mockCreatorAccess = { status: 'loading' }; });

  it('labels the identity layer "Acting as" and shows the member when no channel is active', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel: null, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    const layer = await screen.findByTestId('nav-channel-layer');
    expect(layer).toHaveAccessibleName('Acting as');
    expect(screen.getByTestId('nav-no-active-channel')).toHaveTextContent('Yourself (no channel)');
  });

  it('opens on the channel list when asked, and closes when asked', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true, view: 'channels', focus: true }));
    const option = await screen.findByTestId('nav-channel-option');
    expect(option).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('nav-channel-option-none')).toHaveTextContent('Use without a channel');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('role', expect.stringMatching(/^menuitem/)));
    act(() => requestAccountMenu({ open: false }));
    expect(screen.queryByTestId('nav-menu')).toBeNull();
  });

  it('says it in Arabic', async () => {
    lang = 'ar';
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel: null, channels: [] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    expect(await screen.findByTestId('nav-channel-layer')).toHaveAccessibleName('تتصرّف باسم');
    expect(screen.getByTestId('nav-no-active-channel')).toHaveTextContent('اسمك الشخصي (بدون قناة)');
  });

  it('shows waiting channel invitations with their count, and nothing when there are none', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel, channels: [channel] };
    inviteCount = 2;
    const { unmount } = render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    const link = await screen.findByTestId('nav-menu-channel-invites');
    expect(link).toHaveTextContent('Channel invitations (2)');
    expect(link).toHaveAttribute('href', '/en/settings/channel-invites');
    unmount();
    inviteCount = 0;
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    await screen.findByTestId('nav-channel-layer');
    expect(screen.queryByTestId('nav-menu-channel-invites')).toBeNull();
    inviteCount = 0;
  });

  it('has no Upgrade item, whether requests or payments are on (owner: no upgrade marketing)', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel: null, channels: [] };
    for (const upgradeMode of ['request', 'pay', 'closed']) {
      mockCreatorAccess = { status: 'ready', access: { upgradeMode, canCreateChannel: false, pendingDeletion: false, maxChannels: null, channelsOwned: 0 } };
      const { unmount } = render(<UnifiedNavigation />);
      act(() => requestAccountMenu({ open: true }));
      const menu = await screen.findByTestId('nav-menu');
      expect(screen.queryByTestId('nav-menu-upgrade')).toBeNull();
      expect(menu.querySelector('a[href$="/upgrade"]')).toBeNull();
      expect(menu).not.toHaveTextContent(/Upgrade/);
      unmount();
    }
  });
});
