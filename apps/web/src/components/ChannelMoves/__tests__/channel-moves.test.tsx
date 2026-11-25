/**
 * Channel moves on the web (wiki AUN-CHANNEL-CLAIM CC-7): the fresh sign-in comes first, another
 * account is told it isn't its channel, the form offers the channel, and the offer page answers.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiErrorMessage } from '@al-ummah/shared-types';
import MoveChannel from '../MoveChannel';
import MoveOffers from '../MoveOffers';
import OfferPage from '../OfferPage';
import { isFreshSignIn, MoveApiError, moveErrorMessage } from '@/lib/channels/moves';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';
const reloadChannels = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', isRTL: lang === 'ar' }) }));
let mockProfile: Record<string, unknown> | null = null;
jest.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: mockProfile }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { id: 'u2', displayName: 'Omar Haddad', email: 'omar@example.com' }, reloadChannels }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/en' }));
jest.mock('@/components/NotFoundPage', () => ({ __esModule: true, default: () => <div data-testid="not-found-page" /> }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const api = {
  loadMoveState: jest.fn(),
  searchMoveReceivers: jest.fn(),
  makeMoveOffer: jest.fn(),
  loadMoveOffer: jest.fn(),
  loadMyMoveOffers: jest.fn(),
  acceptMove: jest.fn(),
  declineMove: jest.fn(),
  withdrawMove: jest.fn(),
};
jest.mock('@/lib/channels/moves', () => {
  const actual = jest.requireActual('@/lib/channels/moves');
  return { ...actual, ...Object.fromEntries(['loadMoveState', 'searchMoveReceivers', 'makeMoveOffer', 'loadMoveOffer', 'loadMyMoveOffers', 'acceptMove', 'declineMove', 'withdrawMove'].map((k) => [k, (...a: unknown[]) => (api as Record<string, jest.Mock>)[k](...a)])) };
});

const iso = (s: string) => `⁨${s}⁩`;
const offer = (over: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'offered', createdAt: '2026-11-24T00:00:00Z', expiresAt: new Date(Date.now() + 5.5 * 86_400_000).toISOString(), respondedAt: null, keepContactEmail: false,
  channel: { id: 'ch1', name: 'Morning Adhkar', nameLocalized: { ar: 'أذكار الصباح' }, handle: 'morning', avatarUrl: null },
  from: { name: 'Bilal Ahmed', nameLocalized: { ar: 'بلال أحمد' }, avatarUrl: null },
  to: { name: 'Omar Haddad', avatarUrl: null },
  viewerRole: 'to',
  ...over,
});
const now = () => Math.floor(Date.now() / 1000);
const move = (over: Partial<React.ComponentProps<typeof MoveChannel>> = {}) => render(<MoveChannel channelId="ch1" handle="morning" locale={lang} authTime={now()} signedIn {...over} />);

beforeEach(() => {
  lang = 'en';
  mockProfile = null;
  jest.clearAllMocks();
  window.sessionStorage.clear();
  api.loadMoveState.mockResolvedValue({ offer: null, movableAt: null });
  api.searchMoveReceivers.mockResolvedValue([{ userId: 'u2', name: 'Omar Haddad', nameLocalized: { ar: 'عمر حداد' }, avatarUrl: null }]);
});

describe('Move channel', () => {
  it('asks for a fresh sign-in as it opens, before anything is typed, and comes back here', async () => {
    for (const authTime of [now() - 3600, now() - 301, null]) {
      const view = move({ authTime });
      const button = await screen.findByTestId('move-sign-in-button');
      const url = new URL(button.getAttribute('href')!, 'https://x.test');
      expect([url.pathname, url.searchParams.get('prompt'), url.searchParams.get('return')]).toEqual(['/api/auth/login', 'login', '/en/settings/channel/ch1/move']);
      expect(screen.queryByTestId('move-form')).toBeNull();
      view.unmount();
    }
    expect(isFreshSignIn(now() - 299)).toBe(true);
    // Signed out: the same, and the API is not asked
    api.loadMoveState.mockClear();
    move({ signedIn: false, authTime: null });
    expect(await screen.findByTestId('move-sign-in')).toBeInTheDocument();
    expect(api.loadMoveState).not.toHaveBeenCalled();
  });

  it('tells another account it isn’t their channel, whatever their sign-in, and changes nothing', async () => {
    api.loadMoveState.mockRejectedValue(new MoveApiError('channel_not_found', 404));
    move({ authTime: now() - 3600 });
    expect(await screen.findByTestId('move-not-yours')).toHaveTextContent('This isn’t your channel');
    expect(screen.getByTestId('move-not-yours')).toHaveTextContent(`You’re signed in as ${iso('Omar Haddad')}.`);
    expect(new URL(screen.getByTestId('move-other-account').getAttribute('href')!, 'https://x.test').searchParams.get('prompt')).toBe('login');
    expect(screen.queryByTestId('move-form')).toBeNull();
    expect(api.makeMoveOffer).not.toHaveBeenCalled();
    cleanup();
    // Once the profile loads, its name in the page's language, as in the header
    lang = 'ar';
    mockProfile = { displayName: 'Omar Haddad', displayNameLocalized: { ar: 'عمر حداد' } };
    move({ authTime: now() - 3600 });
    expect(await screen.findByTestId('move-not-yours')).toHaveTextContent(AR.channelMoves.notYours.signedInAs.replace('{name}', iso('عمر حداد')));
  });

  it('offers the channel to an admin picked from the list, with the handle typed', async () => {
    const user = userEvent.setup();
    move();
    await screen.findByTestId('move-form');
    expect(screen.getByTestId('move-send')).toBeDisabled();
    await user.click(screen.getByTestId('move-receiver'));
    await user.click(await screen.findByTestId('move-receiver-option'));
    expect(screen.getByTestId('move-receiver-chosen')).toHaveTextContent('Omar Haddad');
    await user.type(screen.getByTestId('move-confirm'), '@wrong');
    expect(screen.getByTestId('move-send')).toBeDisabled();
    await user.clear(screen.getByTestId('move-confirm'));
    await user.type(screen.getByTestId('move-confirm'), '@Morning');
    await user.click(screen.getByTestId('move-keep-email'));
    api.loadMoveState.mockResolvedValue({ offer: offer({ viewerRole: 'from' }), movableAt: null });
    await user.click(screen.getByTestId('move-send'));
    expect(api.makeMoveOffer).toHaveBeenCalledWith('ch1', { toUserId: 'u2', confirm: '@Morning', keepContactEmail: true });
    expect(await screen.findByTestId('move-open-offer')).toHaveTextContent(`Offered to ${iso('Omar Haddad')}`);
    expect(screen.getByTestId('move-message')).toHaveTextContent('Offer sent.');
  });

  it('a sign-in that became too old while typing keeps the choice for the way back', async () => {
    const user = userEvent.setup();
    const view = move();
    await user.click(await screen.findByTestId('move-receiver'));
    await user.click(await screen.findByTestId('move-receiver-option'));
    await user.type(screen.getByTestId('move-confirm'), 'morning');
    api.makeMoveOffer.mockRejectedValueOnce(new MoveApiError('reauth_required', 403));
    await user.click(screen.getByTestId('move-send'));
    expect(await screen.findByTestId('move-message')).toHaveTextContent('Sign in again to continue.');
    expect(new URL(screen.getByTestId('move-reauth').getAttribute('href')!, 'https://x.test').searchParams.get('prompt')).toBe('login');
    view.unmount();
    move();
    expect(await screen.findByTestId('move-receiver-chosen')).toHaveTextContent('Omar Haddad');
    expect(screen.getByTestId('move-confirm')).toHaveValue('');
  });

  it('shows every refusal in the catalogue’s words, in both languages', async () => {
    const codes = ['receiver_not_channel_admin', 'official_handle', 'move_channel_suspended', 'channel_under_review', 'move_check_unavailable', 'move_in_progress', 'move_channel_live', 'move_channel_has_support', 'move_receiver_not_allowed', 'move_receiver_channel_limit', 'moved_recently', 'offer_open', 'move_confirm_mismatch', 'move_already_owner', 'offer_not_found', 'owner_changed', 'reauth_required', 'move_not_owner'];
    for (const l of ['en', 'ar'] as const) {
      const texts = codes.map((c) => moveErrorMessage(new MoveApiError(c, 409), l));
      expect(new Set(texts).size).toBe(codes.length);
      expect(texts).toEqual(codes.map((c) => apiErrorMessage(c, 409, l)));
      expect(moveErrorMessage(new MoveApiError('something_new', 400), l)).toBe(apiErrorMessage('server_error', 500, l));
      expect(moveErrorMessage(new Error('boom'), l)).not.toContain('boom');
    }
  });

  it('shows the open offer with Withdraw, the cooldown date, or the missing admins', async () => {
    const user = userEvent.setup();
    api.loadMoveState.mockResolvedValue({ offer: offer({ viewerRole: 'from' }), movableAt: null });
    const open = move({ authTime: now() - 3600 });
    await user.click(await screen.findByTestId('move-withdraw'));
    api.loadMoveState.mockResolvedValue({ offer: null, movableAt: null });
    await user.click(await screen.findByTestId('move-withdraw-dialog-confirm'));
    expect(api.withdrawMove).toHaveBeenCalledWith('o1');
    expect(await screen.findByTestId('move-message')).toHaveTextContent('Offer withdrawn.');
    open.unmount();

    api.loadMoveState.mockResolvedValue({ offer: offer({ viewerRole: 'from', status: 'accepting' }), movableAt: null });
    const starting = move();
    expect(await screen.findByTestId('move-open-offer')).toHaveTextContent('The move is starting.');
    expect(screen.queryByTestId('move-withdraw')).toBeNull();
    starting.unmount();

    lang = 'ar';
    api.loadMoveState.mockResolvedValue({ offer: null, movableAt: '2026-12-24T12:00:00.000Z' });
    const cooldown = move();
    expect(await screen.findByTestId('move-cooldown')).toHaveTextContent('٢٤ ديسمبر ٢٠٢٦');
    cooldown.unmount();

    lang = 'en';
    api.loadMoveState.mockResolvedValue({ offer: null, movableAt: null });
    api.searchMoveReceivers.mockResolvedValue([]);
    move();
    await user.click(await screen.findByTestId('move-receiver'));
    expect(await screen.findByTestId('move-no-admins')).toHaveTextContent('Team');
  });

  it('a failed read offers a retry', async () => {
    const user = userEvent.setup();
    api.loadMoveState.mockRejectedValueOnce(new MoveApiError('service_unavailable', 503));
    move();
    await screen.findByTestId('move-load-failed');
    await user.click(screen.getByRole('button', { name: EN.common.retry }));
    expect(await screen.findByTestId('move-form')).toBeInTheDocument();
  });
});

describe('Offer page', () => {
  it('the receiver accepts after an in-app confirmation', async () => {
    const user = userEvent.setup();
    api.loadMoveOffer.mockResolvedValue(offer({ keepContactEmail: true }));
    render(<OfferPage offerId="o1" />);
    const card = await screen.findByTestId('move-offer');
    expect(card).toHaveTextContent(`${iso('Bilal Ahmed')} wants to hand this channel over to you.`);
    expect(card).toHaveTextContent('Expires in 5 days');
    expect(card).toHaveTextContent('Its public contact email stays.');
    await user.click(screen.getByTestId('move-accept'));
    expect(api.acceptMove).not.toHaveBeenCalled();
    api.loadMoveOffer.mockResolvedValue(offer({ status: 'moved' }));
    await user.click(await screen.findByTestId('move-accept-dialog-confirm'));
    expect(api.acceptMove).toHaveBeenCalledWith('o1');
    expect(await screen.findByTestId('move-offer-closed')).toHaveTextContent('The channel is yours.');
    expect(screen.getByTestId('move-message')).toHaveAttribute('data-kind', 'ok');
    expect(reloadChannels).toHaveBeenCalled();
  });

  it('declines, and a refusal shows why', async () => {
    const user = userEvent.setup();
    api.loadMoveOffer.mockResolvedValue(offer());
    api.declineMove.mockRejectedValueOnce(new MoveApiError('offer_not_found', 404));
    render(<OfferPage offerId="o1" />);
    await user.click(await screen.findByTestId('move-decline'));
    expect(await screen.findByTestId('move-message')).toHaveTextContent('This offer is no longer open.');
    api.loadMoveOffer.mockResolvedValue(offer({ status: 'declined' }));
    await user.click(screen.getByTestId('move-decline'));
    await waitFor(() => expect(screen.getByTestId('move-offer-closed')).toHaveTextContent('You declined this offer.'));
  });

  it('says what became of a closed offer, to each reader, in both languages', async () => {
    for (const l of ['en', 'ar'] as const) {
      lang = l;
      for (const status of ['accepting', 'moved', 'declined', 'cancelled', 'expired', 'stopped', 'refused'] as const) {
        for (const viewerRole of ['to', 'from', 'owner'] as const) {
          api.loadMoveOffer.mockResolvedValue(offer({ status, viewerRole }));
          const view = render(<OfferPage offerId="o1" />);
          expect(await screen.findByTestId('move-offer-closed')).toHaveTextContent((l === 'ar' ? AR : EN).channelMoves.closed[status][viewerRole === 'to' ? 'to' : 'from']);
          for (const id of ['move-accept', 'move-decline', 'move-withdraw']) expect(screen.queryByTestId(id)).toBeNull();
          view.unmount();
        }
      }
    }
  });

  it('the owner withdraws; a later owner of the channel only reads; nobody else sees it', async () => {
    api.loadMoveOffer.mockResolvedValue(offer({ viewerRole: 'from' }));
    const own = render(<OfferPage offerId="o1" />);
    expect(await screen.findByTestId('move-withdraw')).toBeInTheDocument();
    expect(screen.queryByTestId('move-accept')).toBeNull();
    own.unmount();
    api.loadMoveOffer.mockResolvedValue(offer({ viewerRole: 'owner' }));
    const later = render(<OfferPage offerId="o1" />);
    await screen.findByTestId('move-offer');
    for (const id of ['move-accept', 'move-decline', 'move-withdraw']) expect(screen.queryByTestId(id)).toBeNull();
    later.unmount();
    for (const code of ['offer_not_found', 'feature_off']) {
      api.loadMoveOffer.mockRejectedValueOnce(new MoveApiError(code, 404));
      const view = render(<OfferPage offerId="o1" />);
      expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe('A failed read', () => {
  const refusal = new MoveApiError('rate_limited', 429);
  it('says the refusal’s reason and tries again, on each page', async () => {
    for (const [load, page, done] of [
      [api.loadMoveState, () => move(), 'move-form'],
      [api.loadMoveOffer, () => render(<OfferPage offerId="o1" />), 'move-offer'],
      [api.loadMyMoveOffers, () => render(<MoveOffers />), 'move-offers-empty'],
    ] as const) {
      load.mockReset();
      load.mockRejectedValueOnce(refusal).mockRejectedValueOnce(new MoveApiError('service_unavailable', 503)).mockResolvedValue(load === api.loadMoveState ? { offer: null, movableAt: null } : load === api.loadMoveOffer ? offer() : { received: [], sent: [], receivedCursor: null, sentCursor: null });
      const view = page();
      expect(await screen.findByTestId('move-load-failed')).toHaveTextContent(moveErrorMessage(refusal, 'en'));
      await userEvent.click(screen.getByRole('button', { name: EN.common.retry }));
      await waitFor(() => expect(screen.getByTestId('move-load-failed')).toHaveTextContent(EN.channelMoves.loadFailed));
      await userEvent.click(screen.getByRole('button', { name: EN.common.retry }));
      expect(await screen.findByTestId(done)).toBeInTheDocument();
      view.unmount();
    }
    api.loadMoveState.mockReset();
    api.loadMoveState.mockRejectedValue(new MoveApiError('feature_off', 404));
    move();
    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
  });

  it('the picker says why it has no one to show, not "no matches"', async () => {
    api.searchMoveReceivers.mockRejectedValue(refusal);
    move();
    await screen.findByTestId('move-form');
    await userEvent.click(screen.getByTestId('move-receiver'));
    expect(await screen.findByTestId('autocomplete-error')).toHaveTextContent(moveErrorMessage(refusal, 'en'));
    await userEvent.type(screen.getByTestId('move-receiver'), 'om');
    await waitFor(() => expect(screen.getByTestId('autocomplete-error')).toHaveTextContent(moveErrorMessage(refusal, 'en')), { timeout: 3000 });
    expect(screen.queryByTestId('autocomplete-no-matches')).toBeNull();
    expect(screen.queryByTestId('move-no-admins')).toBeNull();
  });
});

describe('My offers', () => {
  it('a page with no open offer and a cursor still reaches the next one', async () => {
    api.loadMyMoveOffers.mockResolvedValueOnce({ received: [], sent: [], receivedCursor: '7', sentCursor: null });
    render(<MoveOffers />);
    const more = await screen.findByTestId('move-offers-received-more');
    expect(screen.queryByTestId('move-offers-empty')).toBeNull();
    expect(screen.queryByTestId('move-offers-sent')).toBeNull();
    api.loadMyMoveOffers.mockResolvedValueOnce({ received: [offer({ id: 'o9' })], sent: [], receivedCursor: null, sentCursor: null });
    await userEvent.click(more);
    await waitFor(() => expect(screen.getByTestId('move-offer-item')).toHaveAttribute('data-offer', 'o9'));
  });

  it('shows more offers a page at a time, a failed page keeps what is there, and one being accepted says so', async () => {
    api.loadMyMoveOffers.mockResolvedValueOnce({ received: [offer({ status: 'accepting' })], sent: [], receivedCursor: '7', sentCursor: null });
    render(<MoveOffers />);
    const more = await screen.findByTestId('move-offers-received-more');
    expect(screen.getByTestId('move-offer-starting')).toHaveTextContent(EN.channelMoves.closed.accepting.to);
    expect(screen.queryByTestId('move-offers-sent-more')).toBeNull();
    api.loadMyMoveOffers.mockRejectedValueOnce(new MoveApiError('rate_limited', 429));
    await userEvent.click(more);
    expect(await screen.findByTestId('move-message')).toHaveTextContent(moveErrorMessage(new MoveApiError('rate_limited', 429), 'en'));
    expect(screen.getAllByTestId('move-offer-item')).toHaveLength(1);
    api.loadMyMoveOffers.mockResolvedValueOnce({ received: [offer(), offer({ id: 'o9' })], sent: [], receivedCursor: null, sentCursor: null });
    await userEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId('move-offer-item').map((e) => e.getAttribute('data-offer'))).toEqual(['o1', 'o9']));
    expect(api.loadMyMoveOffers).toHaveBeenLastCalledWith({ side: 'received', cursor: '7' });
    expect(screen.queryByTestId('move-offers-received-more')).toBeNull();
    expect(screen.queryByTestId('move-message')).toBeNull();
  });

  it('lists received and sent offers with names in the page’s language; empty and off', async () => {
    lang = 'ar';
    api.loadMyMoveOffers.mockResolvedValue({ received: [offer()], sent: [offer({ id: 'o2', viewerRole: 'from', to: { name: null, avatarUrl: null } })], receivedCursor: null, sentCursor: null });
    const view = render(<MoveOffers />);
    expect(await screen.findByTestId('move-offers-received')).toHaveTextContent('أذكار الصباح');
    expect(screen.getByTestId('move-offers-received')).toHaveTextContent(`وصلك عرض من ${iso('بلال أحمد')} لنقل هذه القناة إليك.`);
    expect(screen.getByTestId('move-offers-sent')).toHaveTextContent(iso(AR.channelMoves.offers.someone));
    expect(screen.getAllByTestId('move-offer-view').map((a) => a.getAttribute('href'))).toEqual(['/ar/channel-moves/o1', '/ar/channel-moves/o2']);
    expect(view.container.textContent).not.toMatch(/[0-9]/);
    view.unmount();
    api.loadMyMoveOffers.mockResolvedValue({ received: [], sent: [], receivedCursor: null, sentCursor: null });
    const empty = render(<MoveOffers />);
    expect(await screen.findByTestId('move-offers-empty')).toBeInTheDocument();
    empty.unmount();
    api.loadMyMoveOffers.mockRejectedValue(new MoveApiError('feature_off', 404));
    render(<MoveOffers />);
    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
  });
});
