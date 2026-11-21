/**
 * #1673: while the acting identity or the account switches, the header account pill (and the
 * account menu) never shows the email or the email's first letter. The session carries the email
 * as a stand-in display name until the profile loads, so every render through a switch is checked.
 */
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { UnifiedNavigation } from '..';
import { requestAccountMenu } from '@/lib/navigation/account-menu-events';
import { resetIdentityNames } from '@/lib/navigation/identity-name';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';
type State = { user: Record<string, unknown> | null; accounts: Record<string, unknown>[]; loading: boolean };
let state: State;

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, isRTL: lang === 'ar' }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    ...state, error: null, addAccount: jest.fn(), switchAccount: jest.fn(), removeAccount: jest.fn(),
    switchToChannel: jest.fn(), createChannel: jest.fn(), creatingChannel: false, reloadChannels: jest.fn(),
    logout: jest.fn(), logoutAll: jest.fn(),
  }),
}));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'loading' }),
  mayCreateChannel: () => false,
  refreshCreatorAccess: jest.fn(),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { roles: [] } }) }));
// Profiles resolve only when a test says so: the gap a switch opens
const pendingProfiles: Array<{ id: string; set: (p: unknown) => void }> = [];
const profiles: Record<string, Record<string, unknown>> = {};
jest.mock('@/lib/api/profiles-client', () => ({
  fetchProfile: jest.fn((u: { id: string }, set: (p: unknown) => void) => {
    pendingProfiles.push({ id: u.id, set });
    return Promise.resolve(true);
  }),
}));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({
  getAuthProfileUrl: () => 'https://profile.test', getAuthUrl: () => 'https://auth.test', getCmsUrl: () => 'https://cms.test', getWwwUrl: () => 'https://www.test',
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/channels/invites-count', () => ({ useChannelInviteCount: () => 0, CHANNEL_INVITES_CHANGED: 'x' }));

const AMINA = 'amina@test.local';
const OMAR = 'omar@test.local';
const channel = { id: 'ch1', name: 'Community Corner', userId: 'u1', isMain: true, role: 'owner' };
// The session's stand-in: displayName is the email until the profile loads (session-manager.ts)
const amina = (over: Record<string, unknown> = {}) => ({ id: 'u1', email: AMINA, displayName: AMINA, channel: null, channels: [channel], ...over });
const omar = (over: Record<string, unknown> = {}) => ({ id: 'u2', email: OMAR, displayName: OMAR, channel: null, channels: [], ...over });
const accountsFor = (active: string) => [
  { userId: 'u1', email: AMINA, displayName: AMINA, isActive: active === 'u1', channelsCount: 1 },
  { userId: 'u2', email: OMAR, displayName: OMAR, isActive: active === 'u2', channelsCount: 0 },
];

/** No @-address as a visible label anywhere in the header, and the avatar letter is the name's (never the email's). */
function expectNoEmailInHeader() {
  const trigger = screen.queryByTestId('nav-menu-trigger');
  if (trigger) {
    const name = within(trigger).getByTestId('nav-trigger-name').textContent ?? '';
    expect(name).not.toMatch(/@/);
    const letter = trigger.querySelector('span.aun-avatar')?.textContent ?? '';
    if (trigger.querySelector('span.aun-avatar') && name) expect(letter).toBe(Array.from(name)[0].toUpperCase());
    if (!name) expect(letter).toBe('');
  }
  for (const label of document.querySelectorAll('[data-testid="nav-user-name"], .aun-acct-label, .aun-identity-tag')) {
    expect(label.textContent ?? '').not.toMatch(/@/);
  }
}

/** Answer every profile request made so far (the menu rows load one after another). */
async function resolveProfiles() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      while (pendingProfiles.length) {
        const next = pendingProfiles.shift()!;
        if (profiles[next.id]) next.set(profiles[next.id]);
      }
      await Promise.resolve();
    });
  }
}

describe('identity switch never shows the email (#1673)', () => {
  beforeEach(() => {
    lang = 'en';
    resetIdentityNames();
    pendingProfiles.length = 0;
    profiles.u1 = { id: 'u1', email: AMINA, displayName: '', firstName: 'Amina', lastName: 'Yusuf', firstNameLocalized: { ar: 'أمينة' }, lastNameLocalized: { ar: 'يوسف' } };
    profiles.u2 = { id: 'u2', email: OMAR, displayName: 'Omar Farouk', displayNameLocalized: { ar: 'عمر فاروق' } };
  });

  it.each(['en', 'ar'] as const)('first paint before the profile: a neutral pill, never the email (%s)', async (l) => {
    lang = l;
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    render(<UnifiedNavigation />);
    const trigger = screen.getByTestId('nav-menu-trigger');
    expect(trigger).not.toHaveTextContent(/@/);
    expect(trigger.querySelector('span.aun-avatar')).toHaveTextContent('');
    expectNoEmailInHeader();
    await resolveProfiles();
    expect(within(trigger).getByTestId('nav-trigger-name')).toHaveTextContent(l === 'ar' ? 'أمينة يوسف' : 'Amina Yusuf');
    expect(trigger.querySelector('span.aun-avatar')).toHaveTextContent(l === 'ar' ? 'أ' : 'A');
  });

  it('switching to a channel and back to Personal keeps a name in the pill on every render', async () => {
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    const { rerender } = render(<UnifiedNavigation />);
    await resolveProfiles();
    const name = () => screen.getByTestId('nav-trigger-name');
    expect(name()).toHaveTextContent('Amina Yusuf');

    // Switch to the channel: loading, then the session comes back with the email stand-in again
    state = { ...state, loading: true };
    rerender(<UnifiedNavigation />);
    expectNoEmailInHeader();
    expect(name()).toHaveTextContent('Amina Yusuf');
    expect(screen.getByTestId('nav-menu-trigger')).toBeDisabled();
    state = { user: amina({ channel }), accounts: accountsFor('u1'), loading: false };
    rerender(<UnifiedNavigation />);
    expectNoEmailInHeader();
    expect(name()).toHaveTextContent('Community Corner');

    // Back to Personal
    state = { ...state, loading: true };
    rerender(<UnifiedNavigation />);
    expectNoEmailInHeader();
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    rerender(<UnifiedNavigation />);
    expectNoEmailInHeader();
    expect(name()).toHaveTextContent('Amina Yusuf');
    expect(screen.getByTestId('nav-menu-trigger').querySelector('span.aun-avatar')).toHaveTextContent('A');
  });

  it('a header remounted mid-switch (page refresh) paints the last known name, not the email', async () => {
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    const first = render(<UnifiedNavigation />);
    await resolveProfiles();
    first.unmount();
    pendingProfiles.length = 0; // the new mount's profile has not come back yet
    render(<UnifiedNavigation />);
    expect(screen.getByTestId('nav-trigger-name')).toHaveTextContent('Amina Yusuf');
    expectNoEmailInHeader();
  });

  it('switching account shows the other account by its name from the menu row, never its email', async () => {
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    const { rerender } = render(<UnifiedNavigation />);
    await resolveProfiles(); // the profile and every menu row's profile
    act(() => requestAccountMenu({ open: true }));
    const row = await screen.findByRole('menuitem', { name: /Omar Farouk/ });
    expect(row).toHaveTextContent(OMAR); // the email is the line under the name
    expect(row.querySelector('.aun-acct-label')).toHaveTextContent('Omar Farouk');
    expectNoEmailInHeader();

    // The switch: the old identity stays while it loads, then Omar arrives with the email stand-in
    state = { ...state, loading: true };
    rerender(<UnifiedNavigation />);
    expect(screen.getByTestId('nav-trigger-name')).toHaveTextContent('Amina Yusuf');
    expect(screen.queryByTestId('nav-menu')).toBeNull();
    state = { user: omar(), accounts: accountsFor('u2'), loading: false };
    rerender(<UnifiedNavigation />);
    expectNoEmailInHeader();
    expect(screen.getByTestId('nav-trigger-name')).toHaveTextContent('Omar Farouk');
    expect(screen.getByTestId('nav-menu-trigger').querySelector('span.aun-avatar')).toHaveTextContent('O');
    await waitFor(() => expect(screen.getByTestId('nav-trigger-name')).not.toHaveTextContent('Amina'));
  });

  it('the account menu shows the email only as the line under the name', async () => {
    state = { user: amina(), accounts: accountsFor('u1'), loading: false };
    render(<UnifiedNavigation />);
    act(() => requestAccountMenu({ open: true }));
    // Before the profile: no name yet, and the email is not promoted to the name line
    expect(await screen.findByTestId('nav-user-name')).toHaveTextContent('');
    // ...a skeleton holds the name's place, in the menu and in the pill
    expect(screen.getByTestId('nav-user-name').querySelector('[data-skeleton]')).not.toBeNull();
    expect(screen.getByTestId('nav-trigger-name').querySelector('[data-skeleton]')).not.toBeNull();
    expect(screen.getByTestId('nav-trigger-name')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('nav-profile-link')).toHaveTextContent(AMINA);
    expectNoEmailInHeader();
    await resolveProfiles();
    expect(screen.getByTestId('nav-user-name')).toHaveTextContent('Amina Yusuf');
    expect(screen.getByTestId('nav-user-name').querySelector('[data-skeleton]')).toBeNull();
    expect(screen.getByTestId('nav-trigger-name').querySelector('[data-skeleton]')).toBeNull();
    expect(screen.getByTestId('nav-trigger-name')).not.toHaveAttribute('data-loading');
  });
});
