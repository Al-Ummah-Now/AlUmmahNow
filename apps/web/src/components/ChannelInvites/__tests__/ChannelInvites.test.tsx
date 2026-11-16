/** My channel invitations (docs/specs/CHANNEL-ROLES.md §14): Accept and Decline. */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChannelInvites from '..';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';
const reloadChannels = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, isRTL: lang === 'ar' }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ reloadChannels }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const invites = () => [
  { id: 'i1', role: 'editor', channel: { id: 'c1', name: 'Community Corner', handle: 'corner' }, invitedBy: { userId: 'o', displayName: 'Amina' }, createdAt: '2026-11-14T00:00:00Z', expiresAt: new Date(Date.now() + 3.5 * 86_400_000).toISOString() },
  { id: 'i2', role: 'moderator', channel: { id: 'c2', name: 'Second', nameLocalized: { ar: 'الثانية' } }, invitedBy: { userId: 'p' }, createdAt: '2026-11-14T00:00:00Z', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
];
const api = {
  loadMyInvites: jest.fn(async () => invites()),
  acceptInvite: jest.fn(async (_id: string) => ({ channelId: 'c1', role: 'editor' })),
  declineInvite: jest.fn(async (_id: string) => undefined),
};
jest.mock('@/lib/channels/team', () => {
  const actual = jest.requireActual('@/lib/channels/team');
  return {
    ...actual,
    loadMyInvites: () => api.loadMyInvites(),
    acceptInvite: (id: string) => api.acceptInvite(id),
    declineInvite: (id: string) => api.declineInvite(id),
  };
});

describe('ChannelInvites', () => {
  beforeEach(() => { lang = 'en'; jest.clearAllMocks(); });

  it('shows each invitation with the channel, inviter, role, what it allows and expiry', async () => {
    render(<ChannelInvites />);
    const [first, second] = await screen.findAllByTestId('channel-invite');
    expect(first).toHaveTextContent('Community Corner');
    expect(first).toHaveTextContent('@corner');
    expect(first).toHaveTextContent('Amina invited you as Editor');
    expect(first).toHaveTextContent(EN.channelRoles.roleHelp.editor);
    expect(first).toHaveTextContent('Expires in 3 days');
    expect(second).toHaveTextContent('someone invited you as Channel moderator');
    expect(second).toHaveTextContent('Expires today');
  });

  it('says the days left with the Arabic plural forms (never «3 من الأيام»)', async () => {
    lang = 'ar';
    render(<ChannelInvites />);
    const [first] = await screen.findAllByTestId('channel-invite');
    expect(first.textContent).toMatch(/تنتهي بعد (3|٣) أيام/);
    expect(first.textContent).not.toMatch(/من الأيام/);
  });

  it('Accept joins, reloads the channel menu, and offers the channel', async () => {
    const changed = jest.fn();
    window.addEventListener('aun:channel-invites-changed', changed);
    render(<ChannelInvites />);
    fireEvent.click((await screen.findAllByTestId('invite-accept'))[0]);
    await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledWith('i1'));
    expect(await screen.findByTestId('invites-message')).toHaveTextContent('You joined Community Corner as Editor.');
    expect(screen.getByTestId('invites-open-channel')).toHaveAttribute('href', '/en/channels/c1');
    expect(screen.getAllByTestId('channel-invite')).toHaveLength(1);
    expect(reloadChannels).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
  });

  it('Decline removes it; a closed invitation shows friendly copy and refreshes', async () => {
    const { TeamError } = jest.requireActual('@/lib/channels/team');
    render(<ChannelInvites />);
    fireEvent.click((await screen.findAllByTestId('invite-decline'))[1]);
    await waitFor(() => expect(api.declineInvite).toHaveBeenCalledWith('i2'));
    expect(await screen.findByTestId('invites-message')).toHaveTextContent('Invitation declined.');
    api.acceptInvite.mockRejectedValueOnce(new TeamError('invite_not_found', 404));
    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation is no longer open.');
    await waitFor(() => expect(api.loadMyInvites).toHaveBeenCalledTimes(2));
  });

  it('empty state, and Arabic with the localized channel name', async () => {
    api.loadMyInvites.mockResolvedValueOnce([]);
    const { unmount } = render(<ChannelInvites />);
    expect(await screen.findByTestId('invites-empty')).toHaveTextContent('You have no channel invitations.');
    unmount();
    lang = 'ar';
    render(<ChannelInvites />);
    expect((await screen.findAllByTestId('channel-invite'))[1]).toHaveTextContent('الثانية');
    expect(screen.getAllByTestId('invite-accept')[0]).toHaveTextContent('قبول');
  });
});
