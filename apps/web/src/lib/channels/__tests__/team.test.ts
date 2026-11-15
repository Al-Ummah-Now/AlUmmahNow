import { daysUntil, inviteTarget, TeamError } from '../team';
import { teamErrorMessage } from '../team-errors';
import { activityLine } from '@/components/ChannelTeam/TeamActivity';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;

jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthInfo: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

describe('invitation target (§4.1)', () => {
  it('an address is an email, anything else (with or without @) a handle', () => {
    expect(inviteTarget(' Sara@Example.com ')).toEqual({ email: 'Sara@Example.com' });
    expect(inviteTarget('@saratalks')).toEqual({ handle: 'saratalks' });
    expect(inviteTarget('saratalks')).toEqual({ handle: 'saratalks' });
  });
});

describe('daysUntil', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  it('counts whole days and never goes below zero', () => {
    expect(daysUntil('2026-11-28T12:00:00Z', now)).toBe(14);
    expect(daysUntil('2026-11-14T20:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-11-01T00:00:00Z', now)).toBe(0);
  });
});

describe('team error copy', () => {
  it('maps every invitation code to friendly words, en and ar', () => {
    expect(teamErrorMessage(EN, new TeamError('already_invited'))).toBe(EN.channelRoles.errors.alreadyInvited);
    expect(teamErrorMessage(EN, new TeamError('rate_limited'))).toBe(EN.channelRoles.errors.rateLimited);
    expect(teamErrorMessage(AR, new TeamError('shared_limit'))).toBe(AR.channelRoles.errors.sharedLimit);
    expect(teamErrorMessage(EN, new Error('boom'))).toBe(EN.channelRoles.errors.generic);
  });
});

describe('activity lines (§9)', () => {
  const base = { id: 'a', createdAt: '2026-11-14T00:00:00Z', actorId: 'owner', actorName: 'Amina' };
  it('names people and roles in the reader\'s language', () => {
    expect(activityLine({ ...base, action: 'role_changed', targetUserId: 'ed', targetName: 'Ed', oldRole: 'editor', newRole: 'moderator' }, EN))
      .toBe('Amina changed Ed from Editor to Channel moderator');
    expect(activityLine({ ...base, action: 'invite_accepted', newRole: 'editor', actorName: 'Sara' }, AR)).toBe('انضم Sara بدور محرر');
  });
  it('an email invitation never shows the address; an erased account reads as deleted', () => {
    expect(activityLine({ ...base, action: 'invite_sent', newRole: 'editor' }, EN)).toBe('Amina invited someone by email as Editor');
    expect(activityLine({ ...base, action: 'member_removed', targetUserId: 'deleted-user' }, EN)).toBe('Amina removed a deleted account');
  });
});
