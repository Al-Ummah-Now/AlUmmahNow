/**
 * @jest-environment jsdom
 */
// Hidden when off (wiki "Product rules → Hidden when off"): without a creator tier the channel
// section shows no "by invitation" notice and no empty state that invites creating a channel.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChannelManagementSection } from '../index';
import { ChannelManagementSection as ChannelManagementSectionRTL } from '../rtl';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', dir: 'ltr', isRTL: false }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/channelManagement/DeleteChannelDialog', () => ({ CHANNEL_DELETED_PARAM: 'deleted', DeleteChannelDialog: () => null }));

let mockChannels: Array<{ id: string; name: string; userId: string }> = [];
const mockCreateChannel = jest.fn();
let capturedOnTermsRequired: (() => void) | undefined;
jest.mock('@/hooks/useChannels', () => ({
  useChannels: (opts?: { onTermsRequired?: () => void }) => {
    capturedOnTermsRequired = opts?.onTermsRequired;
    return { channels: mockChannels, isLoading: false, error: null, createChannel: mockCreateChannel, refetch: jest.fn() };
  },
}));

type Access = { tier: { id: string; channels?: boolean; unlimited?: boolean } | null; canCreateChannel: boolean; maxChannels: number | null; pendingDeletion: boolean; termsAccepted?: boolean; termsVersion?: string };
let mockAccess: Access;
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: mockAccess }),
  mayCreateChannel: (state: { status: string; access: Access }) => state.status !== 'ready' || state.access.canCreateChannel,
  needsCreatorTerms: (state: { status: string; access: Access }) => state.status === 'ready' && state.access.termsAccepted === false,
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
  markCreatorTermsRequired: jest.fn(),
}));

describe('ChannelManagementSection, hidden when off', () => {
  beforeEach(() => {
    mockChannels = [];
    mockCreateChannel.mockReset();
    capturedOnTermsRequired = undefined;
    mockAccess = { tier: null, canCreateChannel: false, maxChannels: null, pendingDeletion: false };
  });

  it('no tier and no channels: renders nothing (no notice, no empty state)', () => {
    const { container } = render(<ChannelManagementSection initialChannels={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/invitation/i)).toBeNull();
  });

  it('no tier but channels already there: lists them, with no create button and no notice', () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByText('Noor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create channel/i })).toBeNull();
  });

  it('a tier at its channel limit: the limit as a plain fact', () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    mockAccess = { tier: { id: 'creator', channels: true }, canCreateChannel: false, maxChannels: 1, pendingDeletion: false };
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByTestId('channel-limit-reached')).toHaveTextContent('1');
  });

  it('Free (a tier without channels): no limit line and no notice (hidden when off)', () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    mockAccess = { tier: { id: 'member', channels: false }, canCreateChannel: false, maxChannels: null, pendingDeletion: false };
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.queryByTestId('channel-limit-reached')).toBeNull();
  });

  it('a tier that may create: shows the sentence-case empty state and action', () => {
    mockAccess = { tier: { id: 'creator', channels: true }, canCreateChannel: true, maxChannels: 3, pendingDeletion: false };
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByRole('heading', { name: 'No channels yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create channel' })).toBeInTheDocument();
  });

  it('keeps CreateChannelDialog mounted with typed values and opens CreatorTermsDialog over it on 403 terms_required', async () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    mockAccess = { tier: { id: 'creator', channels: true }, canCreateChannel: true, maxChannels: 3, pendingDeletion: false, termsAccepted: true };
    mockCreateChannel.mockImplementation(async () => {
      capturedOnTermsRequired?.();
      return false;
    });

    render(<ChannelManagementSection initialChannels={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /create channel/i }));

    const nameInput = screen.getByLabelText(/channel name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Preserved Draft Channel' } });
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => expect(screen.getByTestId('creator-terms-modal')).toBeInTheDocument());
    // Form stays mounted with typed value intact, and no generic error toast is shown
    expect((screen.getByLabelText(/channel name/i) as HTMLInputElement).value).toBe('Preserved Draft Channel');
    expect(screen.queryByTestId('channel-toast')).toBeNull();
  });

  it.each([['English', ChannelManagementSection, /create channel/i, /channel name/i], ['Arabic', ChannelManagementSectionRTL, /قناة جديدة/, /اسم القناة/]] as const)('%s: what was refused is not offered again once the draft is edited', async (_name, Section, create, label) => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    mockAccess = { tier: { id: 'creator', channels: true }, canCreateChannel: true, maxChannels: 3, pendingDeletion: false, termsAccepted: true };
    mockCreateChannel.mockImplementation(async () => {
      capturedOnTermsRequired?.();
      return false;
    });
    render(<Section initialChannels={[]} />);
    fireEvent.click(screen.getByRole('button', { name: create }));
    const name = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'First name' } });
    fireEvent.submit(name.closest('form')!);
    fireEvent.click(await screen.findByTestId('creator-terms-cancel'));
    expect(await screen.findByTestId('create-channel-terms')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'Second name' } });
    expect(screen.queryByTestId('create-channel-terms')).toBeNull();
  });
});
