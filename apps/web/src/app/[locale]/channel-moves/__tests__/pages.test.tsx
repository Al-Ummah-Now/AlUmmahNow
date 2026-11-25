/** The move pages check the switch before the sign-in: off is the site's 404 for a visitor too (CC-7). */
import { render, screen } from '@testing-library/react';

const mockOff = jest.fn();
const mockAuth = jest.fn();
jest.mock('@/lib/channels/moves-server', () => ({ channelMovesOff: () => mockOff() }));
jest.mock('@/lib/api/server-auth', () => ({ getServerAuthContext: () => mockAuth() }));
jest.mock('@/lib/api/channels', () => ({ getChannelById: async () => null }));
jest.mock('@/lib/auth/token-refresh', () => ({ decodeJwtPayload: () => null }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
jest.mock('@/components/common/SignInPrompt', () => ({ SignInPrompt: () => <div data-testid="sign-in" /> }));
jest.mock('@/components/ChannelMoves/MoveOffers', () => ({ __esModule: true, default: () => <div data-testid="offers" /> }));
jest.mock('@/components/ChannelMoves/OfferPage', () => ({ __esModule: true, default: () => <div data-testid="offer" /> }));
jest.mock('@/components/ChannelMoves/MoveChannel', () => ({ __esModule: true, default: ({ signedIn }: { signedIn: boolean }) => <div data-testid="move" data-signed-in={String(signedIn)} /> }));
jest.mock('@/components/ChannelSettingsBreadcrumb', () => ({ __esModule: true, default: () => null }));

import ChannelMovesPage from '../page';
import ChannelMoveOfferPage from '../[offerId]/page';
import MoveChannelPage from '../../settings/(move)/channel/[id]/move/page';

const PAGES: Array<[string, () => Promise<React.ReactElement>, string, string]> = [
  ['my offers', () => ChannelMovesPage({ params: Promise.resolve({ locale: 'en' }) }), 'sign-in', 'offers'],
  ['one offer', () => ChannelMoveOfferPage({ params: Promise.resolve({ locale: 'en', offerId: 'o1' }) }), 'sign-in', 'offer'],
  ['Move channel', () => MoveChannelPage({ params: Promise.resolve({ locale: 'en', id: 'ch1' }) }), 'move', 'move'],
];

describe.each(PAGES)('%s', (_name, page, signedOut, signedIn) => {
  it('is the 404 while moves are off, signed out or in', async () => {
    mockOff.mockResolvedValue(true);
    for (const auth of [null, { userId: 'u1' }]) {
      mockAuth.mockResolvedValue(auth);
      await expect(page()).rejects.toThrow('NOT_FOUND');
    }
  });

  it('asks a visitor to sign in, and shows the page signed in, while they are on', async () => {
    mockOff.mockResolvedValue(false);
    mockAuth.mockResolvedValue(null);
    const view = render(await page());
    expect(screen.getByTestId(signedOut)).toBeInTheDocument();
    view.unmount();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    render(await page());
    expect(screen.getByTestId(signedIn)).toBeInTheDocument();
  });
});
