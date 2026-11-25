/**
 * The header stays mounted through a channel switch or a new channel (#1058), so the account menu
 * closes itself once the choice is made; a refused switch keeps it open.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UnifiedNavigation } from '..';

const mockEN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const mockSwitch = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockEN, lang: 'en', dir: 'ltr', isRTL: false }) }));
const mockChannel = { id: 'ch1', name: 'Community Corner', userId: 'u1', isMain: true, role: 'owner' };
const mockUser = { id: 'u1', email: 'amina@example.com', displayName: 'Amina', channel: mockChannel, channels: [mockChannel] };
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    user: mockUser, accounts: [{ userId: 'u1', email: 'amina@example.com', displayName: 'Amina', isActive: true, channelsCount: 1 }], loading: false, error: null, addAccount: jest.fn(), switchAccount: jest.fn(), removeAccount: jest.fn(),
    switchToChannel: (...a: unknown[]) => mockSwitch(...a), createChannel: (...a: unknown[]) => mockCreate(...a), creatingChannel: false, reloadChannels: jest.fn(), logout: jest.fn(), logoutAll: jest.fn(),
  }),
}));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: true, canCreateChannel: true, channelsOwned: 1, maxChannels: 3, termsAccepted: true } }),
  mayCreateChannel: () => true,
  needsCreatorTerms: () => false,
  refreshCreatorAccess: jest.fn(),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { roles: [] } }) }));
jest.mock('@/lib/api/profiles-client', () => ({ fetchProfile: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({ getAuthProfileUrl: () => 'https://profile.test', getAuthUrl: () => 'https://auth.test', getCmsUrl: () => 'https://cms.test', getWwwUrl: () => 'https://www.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/channels/invites-count', () => ({ useChannelInviteCount: () => 0, CHANNEL_INVITES_CHANGED: 'x' }));

beforeEach(() => jest.clearAllMocks());

const openSwitcher = async () => {
  render(<UnifiedNavigation />);
  fireEvent.click(screen.getByTestId('nav-menu-trigger'));
  fireEvent.click(await screen.findByTestId('nav-switch-channel'));
};

it.each([['nav-channel-option-none', null], ['nav-channel-option', 'ch1']] as const)('closes after choosing %s', async (testId, id) => {
  mockSwitch.mockResolvedValue(true);
  await openSwitcher();
  await act(async () => { fireEvent.click(screen.getByTestId(testId)); });
  expect(mockSwitch).toHaveBeenCalledWith(id);
  expect(screen.queryByTestId('nav-menu')).toBeNull();
});

it('stays open when the switch is refused', async () => {
  mockSwitch.mockResolvedValue(false);
  await openSwitcher();
  await act(async () => { fireEvent.click(screen.getByTestId('nav-channel-option-none')); });
  expect(screen.getByTestId('nav-menu')).toBeInTheDocument();
});

it('closes after creating a channel, and stays open when it was not created', async () => {
  mockCreate.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ch2' });
  await openSwitcher();
  fireEvent.click(screen.getByTestId('nav-create-channel'));
  const name = document.getElementById('nav-new-channel-name') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Noor' } });
  await act(async () => { fireEvent.keyDown(name, { key: 'Enter' }); });
  expect(screen.getByTestId('nav-menu')).toBeInTheDocument();
  await act(async () => { fireEvent.keyDown(name, { key: 'Enter' }); });
  expect(screen.queryByTestId('nav-menu')).toBeNull();
});
