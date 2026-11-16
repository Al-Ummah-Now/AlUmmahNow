/**
 * @jest-environment jsdom
 */
// Hidden when off (wiki "Product rules → Hidden when off"): without a creator tier the channel
// section shows no "by invitation" notice and no empty state that invites creating a channel.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChannelManagementSection } from '../index';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', dir: 'ltr', isRTL: false }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/channelManagement/DeleteChannelDialog', () => ({ CHANNEL_DELETED_PARAM: 'deleted', DeleteChannelDialog: () => null }));

let mockChannels: Array<{ id: string; name: string; userId: string }> = [];
jest.mock('@/hooks/useChannels', () => ({
  useChannels: () => ({ channels: mockChannels, isLoading: false, error: null, createChannel: jest.fn(), refetch: jest.fn() }),
}));

type Access = { tier: { id: string } | null; canCreateChannel: boolean; maxChannels: number | null; pendingDeletion: boolean };
let mockAccess: Access;
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: mockAccess }),
  mayCreateChannel: (state: { status: string; access: Access }) => state.status !== 'ready' || state.access.canCreateChannel,
}));

describe('ChannelManagementSection, hidden when off', () => {
  beforeEach(() => {
    mockChannels = [];
    mockAccess = { tier: null, canCreateChannel: false, maxChannels: null, pendingDeletion: false };
  });

  it('no tier and no channels: renders nothing (no notice, no empty state)', () => {
    const { container } = render(<ChannelManagementSection initialChannels={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('uploads-by-invitation')).toBeNull();
    expect(screen.queryByText(/invitation/i)).toBeNull();
  });

  it('no tier but channels already there: lists them, with no create button and no notice', () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByText('Noor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create channel/i })).toBeNull();
    expect(screen.queryByTestId('uploads-by-invitation')).toBeNull();
  });

  it('a tier at its channel limit: the limit as a plain fact', () => {
    mockChannels = [{ id: 'c1', name: 'Noor', userId: 'u1' }];
    mockAccess = { tier: { id: 'creator' }, canCreateChannel: false, maxChannels: 1, pendingDeletion: false };
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByTestId('channel-limit-reached')).toHaveTextContent('1');
  });

  it('a tier that may create: offers Create Channel', () => {
    mockAccess = { tier: { id: 'creator' }, canCreateChannel: true, maxChannels: 3, pendingDeletion: false };
    render(<ChannelManagementSection initialChannels={[]} />);
    expect(screen.getByRole('button', { name: /create channel/i })).toBeInTheDocument();
  });
});
