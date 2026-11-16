/**
 * The account menu's identity layer (owner decision D5, docs/features/HELP-AND-TOUR.md): the
 * section is labelled "Acting as"; the identities follow the YouTube/Facebook pattern: you (your
 * picture and name, tagged "Personal") first, then each channel (its logo and name, tagged
 * "Channel"); never "no channel" / "without a channel". Other
 * parts of the page (the identity tour) open it on a view through
 * requestAccountMenu.
 */
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

  it('labels the identity layer "Acting as" and shows you, tagged Personal, when no channel is active', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', avatarUrl: 'https://img.test/amina.png', channel: null, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    const layer = await screen.findByTestId('nav-channel-layer');
    expect(layer).toHaveAccessibleName('Acting as');
    const current = screen.getByTestId('nav-no-active-channel');
    expect(current).toHaveAttribute('data-identity', 'personal');
    expect(current).toHaveTextContent('Amina');
    expect(within(current).getByTestId('nav-identity-tag')).toHaveTextContent('Personal');
    expect(current.querySelector('img')).toHaveAttribute('src', 'https://img.test/amina.png');
    expect(layer).not.toHaveTextContent(/no channel|without a channel|none/i);
  });

  it('shows the active channel with its logo, name and the Channel tag', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel: { ...channel, avatarUrl: 'https://img.test/corner.png' }, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    const current = await screen.findByTestId('nav-active-channel');
    expect(current).toHaveAttribute('data-identity', 'channel');
    expect(current).toHaveTextContent('Community Corner');
    expect(within(current).getByTestId('nav-identity-tag')).toHaveTextContent('Channel');
    expect(current.querySelector('img')).toHaveAttribute('src', 'https://img.test/corner.png');
  });

  it('header account button shows the active identity: the channel logo and name, or your own (rule 8)', () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', avatarUrl: 'https://img.test/amina.png', channel: { ...channel, avatarUrl: 'https://img.test/corner.png' }, channels: [channel] };
    const { unmount } = render(<UnifiedNavigation />);
    let trigger = screen.getByTestId('nav-menu-trigger');
    expect(trigger.querySelector('img')).toHaveAttribute('src', 'https://img.test/corner.png');
    expect(within(trigger).getByTestId('nav-trigger-name')).toHaveTextContent('Community Corner');
    expect(within(trigger).getByTestId('nav-trigger-name')).toHaveAttribute('data-identity', 'channel');
    expect(trigger).not.toHaveTextContent('Amina');
    unmount();
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', avatarUrl: 'https://img.test/amina.png', channel: null, channels: [channel] };
    render(<UnifiedNavigation />);
    trigger = screen.getByTestId('nav-menu-trigger');
    expect(trigger.querySelector('img')).toHaveAttribute('src', 'https://img.test/amina.png');
    expect(within(trigger).getByTestId('nav-trigger-name')).toHaveTextContent('Amina');
    expect(within(trigger).getByTestId('nav-trigger-name')).toHaveAttribute('data-identity', 'personal');
  });

  it('names you by your email only when there is no name (never an @handle)', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: '', userName: 'amina_handle', channel: null, channels: [] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    const current = await screen.findByTestId('nav-no-active-channel');
    expect(current).toHaveTextContent('amina@test.local');
    expect(current).not.toHaveTextContent('amina_handle');
  });

  it('opens on the channel list when asked, and closes when asked', async () => {
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true, view: 'channels', focus: true }));
    const option = await screen.findByTestId('nav-channel-option');
    expect(option).toHaveAttribute('aria-checked', 'true');
    expect(within(option).getByTestId('nav-identity-tag')).toHaveTextContent('Channel');
    // The picker is headed "Acting as"; you come first, by name, tagged Personal
    const picker = screen.getByRole('group', { name: 'Acting as' });
    const radios = within(picker).getAllByRole('menuitemradio');
    expect(radios[0]).toBe(screen.getByTestId('nav-channel-option-none'));
    expect(radios[0]).toHaveTextContent('Amina');
    expect(within(radios[0]).getByTestId('nav-identity-tag')).toHaveTextContent('Personal');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(picker).not.toHaveTextContent(/no channel|without a channel|none/i);
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
    const current = screen.getByTestId('nav-no-active-channel');
    expect(current).toHaveTextContent('Amina');
    expect(within(current).getByTestId('nav-identity-tag')).toHaveTextContent('حساب شخصي');
    expect(current).not.toHaveTextContent(/بدون قناة/);
  });

  it('tags channels «قناة» in the Arabic picker', async () => {
    lang = 'ar';
    user = { id: 'u1', email: 'amina@test.local', displayName: 'Amina', channel: null, channels: [channel] };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true, view: 'channels' }));
    const option = await screen.findByTestId('nav-channel-option');
    expect(within(option).getByTestId('nav-identity-tag')).toHaveTextContent('قناة');
    expect(within(screen.getByTestId('nav-channel-option-none')).getByTestId('nav-identity-tag')).toHaveTextContent('حساب شخصي');
    expect(screen.getByRole('group', { name: 'تتصرّف باسم' })).toBeInTheDocument();
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
