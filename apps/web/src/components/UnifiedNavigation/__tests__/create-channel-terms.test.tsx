/** Creating a channel from the header menu, refused with `terms_required` (#1929): accepting creates it. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UnifiedNavigation } from '..';

const mockEN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const mockCreate = jest.fn();
let mockTermsAccepted: boolean | undefined = true;
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockEN, lang: 'en', dir: 'ltr', isRTL: false }) }));
const mockUser = { id: 'u1', email: 'amina@example.com', displayName: 'Amina', channel: null, channels: [] };
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    user: mockUser, accounts: [{ userId: 'u1', email: 'amina@example.com', displayName: 'Amina', isActive: true, channelsCount: 0 }], loading: false, error: null, addAccount: jest.fn(), switchAccount: jest.fn(), removeAccount: jest.fn(),
    switchToChannel: jest.fn(), createChannel: (...a: unknown[]) => mockCreate(...a), creatingChannel: false, reloadChannels: jest.fn(), logout: jest.fn(), logoutAll: jest.fn(),
  }),
}));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: true, canCreateChannel: true, channelsOwned: 0, maxChannels: 3, termsAccepted: mockTermsAccepted, termsVersion: '2026-11-24' } }),
  mayCreateChannel: () => true,
  needsCreatorTerms: (c: { access: { termsAccepted?: boolean } }) => c.access.termsAccepted === false,
  refreshCreatorAccess: jest.fn(),
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { roles: [] } }) }));
jest.mock('@/lib/api/profiles-client', () => ({ fetchProfile: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({ getAuthProfileUrl: () => 'https://profile.test', getAuthUrl: () => 'https://auth.test', getCmsUrl: () => 'https://cms.test', getWwwUrl: () => 'https://www.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/channels/invites-count', () => ({ useChannelInviteCount: () => 0, CHANNEL_INVITES_CHANGED: 'x' }));

beforeEach(() => {
  mockTermsAccepted = true;
  mockCreate.mockReset();
});

const openForm = async () => {
  render(<UnifiedNavigation />);
  fireEvent.click(screen.getByTestId('nav-menu-trigger'));
  fireEvent.click(await screen.findByTestId('nav-create-channel'));
};
const name = () => document.getElementById('nav-new-channel-name') as HTMLInputElement | null;
const accept = async () => {
  fireEvent.click(screen.getByTestId('creator-terms-checkbox'));
  await act(async () => { fireEvent.click(screen.getByTestId('creator-terms-agree')); });
};

it('creates the typed channel once the Terms are accepted', async () => {
  mockCreate.mockImplementationOnce(async (_data: unknown, o: { onTermsRequired: () => void }) => { o.onTermsRequired(); return null; });
  mockCreate.mockResolvedValueOnce({ id: 'ch9' });
  await openForm();
  fireEvent.change(name()!, { target: { value: 'Noor' } });
  await act(async () => { fireEvent.keyDown(name()!, { key: 'Enter' }); });
  expect(await screen.findByTestId('creator-terms-gate')).toBeInTheDocument();
  await accept();
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(mockCreate.mock.calls[1][0]).toEqual({ name: 'Noor' });
  expect(mockCreate.mock.calls[0][0]).toEqual({ name: 'Noor' });
  expect(screen.queryByTestId('creator-terms-gate')).toBeNull();
});

it('a name left from a cancelled try is not created by accepting before the form', async () => {
  mockCreate.mockImplementationOnce(async (_data: unknown, o: { onTermsRequired: () => void }) => { o.onTermsRequired(); return null; });
  await openForm();
  fireEvent.change(name()!, { target: { value: 'Noor' } });
  await act(async () => { fireEvent.keyDown(name()!, { key: 'Enter' }); });
  mockTermsAccepted = false;
  fireEvent.click(await screen.findByTestId('creator-terms-cancel'));
  fireEvent.click(await screen.findByTestId('nav-create-channel'));
  await accept();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it('asked before anything is typed, accepting shows the form and creates nothing', async () => {
  mockTermsAccepted = false;
  await openForm();
  expect(screen.getByTestId('creator-terms-gate')).toBeInTheDocument();
  mockTermsAccepted = true;
  await accept();
  expect(mockCreate).not.toHaveBeenCalled();
});
