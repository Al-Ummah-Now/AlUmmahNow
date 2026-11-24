/**
 * The channel Team page (docs/specs/CHANNEL-ROLES.md §14): invite by email or
 * @handle, pending invitations with Cancel, the Activity tab, and what each
 * role sees.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChannelTeam from '..';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, isRTL: lang === 'ar' }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { id: 'owner' }, reloadChannels: jest.fn() }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/search/suggest-client', () => ({ fetchSuggestions: jest.fn(async () => []) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const team = {
  members: [
    { userId: 'owner', role: 'owner', displayName: 'Amina', isYou: true },
    { userId: 'ed', role: 'editor', displayName: 'Ed', isYou: false },
  ],
  invites: [
    { id: 'i1', role: 'moderator', inviteeEmail: 'new@example.com', invitedBy: 'owner', createdAt: '2026-11-14T00:00:00Z', expiresAt: new Date(Date.now() + 12.5 * 86_400_000).toISOString() },
  ],
  maxMembers: 50,
};

const api = {
  loadTeam: jest.fn(async () => team),
  inviteToTeam: jest.fn(async () => team),
  cancelTeamInvite: jest.fn(async () => ({ ...team, invites: [] })),
  changeTeamRole: jest.fn(async () => team),
  removeTeamMember: jest.fn(async () => undefined),
  loadTeamActivity: jest.fn(async () => ({
    entries: [{ id: 'a1', action: 'invite_sent', actorId: 'owner', actorName: 'Amina', newRole: 'moderator', createdAt: new Date().toISOString() }],
    nextCursor: null,
  })),
};
jest.mock('@/lib/channels/team', () => {
  const actual = jest.requireActual('@/lib/channels/team');
  return {
    ...actual,
    loadTeam: (...a: unknown[]) => api.loadTeam(...(a as [])),
    inviteToTeam: (...a: unknown[]) => api.inviteToTeam(...(a as [])),
    cancelTeamInvite: (...a: unknown[]) => api.cancelTeamInvite(...(a as [])),
    changeTeamRole: (...a: unknown[]) => api.changeTeamRole(...(a as [])),
    removeTeamMember: (...a: unknown[]) => api.removeTeamMember(...(a as [])),
    loadTeamActivity: (...a: unknown[]) => api.loadTeamActivity(...(a as [])),
  };
});

describe('ChannelTeam', () => {
  beforeEach(() => { lang = 'en'; jest.clearAllMocks(); });

  it('lists members and pending invitations; Cancel closes one', async () => {
    render(<ChannelTeam channelId="team" role="owner" locale="en" />);
    const invite = await screen.findByTestId('team-invite');
    expect(invite).toHaveTextContent('new@example.com');
    expect(invite).toHaveTextContent('Channel moderator • expires in 12 days');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the invitation for new@example.com' }));
    await waitFor(() => expect(api.cancelTeamInvite).toHaveBeenCalledWith('team', 'i1'));
    expect(await screen.findByTestId('team-message')).toHaveTextContent('Invitation canceled.');
    expect(screen.queryByTestId('team-invite')).toBeNull();
  });

  it('sends an email invitation with the chosen role and says it waits for acceptance', async () => {
    render(<ChannelTeam channelId="team" role="owner" locale="en" />);
    await screen.findByTestId('team-list');
    await userEvent.type(screen.getByRole('combobox', { name: 'Email or @handle' }), 'friend@example.com');
    fireEvent.change(screen.getByTestId('team-add-role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByTestId('team-add-submit'));
    await waitFor(() => expect(api.inviteToTeam).toHaveBeenCalledWith('team', 'friend@example.com', 'admin'));
    expect(await screen.findByTestId('team-message')).toHaveTextContent('Invitation sent. They get the role when they accept.');
  });

  it('shows a friendly message for an API code', async () => {
    const { TeamError } = jest.requireActual('@/lib/channels/team');
    api.inviteToTeam.mockRejectedValueOnce(new TeamError('already_invited', 409));
    render(<ChannelTeam channelId="team" role="owner" locale="en" />);
    await screen.findByTestId('team-list');
    await userEvent.type(screen.getByRole('combobox', { name: 'Email or @handle' }), '@saratalks');
    fireEvent.click(screen.getByTestId('team-add-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This person already has a pending invitation.');
  });

  it('the Activity tab lists the log', async () => {
    render(<ChannelTeam channelId="team" role="admin" locale="en" />);
    await screen.findByTestId('team-list');
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByTestId('team-activity-entry')).toHaveTextContent('Amina invited someone by email as Channel moderator');
  });

  it('a channel admin can only invite editors and moderators', async () => {
    render(<ChannelTeam channelId="team" role="admin" locale="en" />);
    await screen.findByTestId('team-list');
    const options = Array.from((screen.getByTestId('team-add-role') as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['editor', 'moderator']);
  });

  it('an editor sees no tabs, no invite form, only their role and Leave', () => {
    render(<ChannelTeam channelId="team" role="editor" locale="en" />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('team-add-form')).toBeNull();
    expect(screen.getByTestId('team-member')).toHaveTextContent('Editor');
    expect(screen.getByTestId('team-leave')).toBeInTheDocument();
    expect(api.loadTeam).not.toHaveBeenCalled();
  });

  it('Arabic: tabs and invitation copy are translated', async () => {
    lang = 'ar';
    render(<ChannelTeam channelId="team" role="owner" locale="ar" />);
    expect(await screen.findByRole('tab', { name: 'النشاط' })).toBeInTheDocument();
    expect(await screen.findByTestId('team-invite')).toHaveTextContent('مراقب القناة');
  });
});
