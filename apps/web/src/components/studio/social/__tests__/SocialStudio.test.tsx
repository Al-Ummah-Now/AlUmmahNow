import { render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { SocialStudio } from '../SocialStudio';
import type { SocialOverview } from '@/lib/studio/social';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: STUDIO_EN } }) }));
jest.mock('@/lib/studio/social-client', () => ({ socialClient: { confirmConnect: jest.fn() } }));
jest.mock('../SocialAccounts', () => ({
  SocialAccounts: ({ accounts }: { accounts: Array<{ handle: string }> }) => <ul data-testid="accounts">{accounts.map((a) => <li key={a.handle}>{a.handle}</li>)}</ul>,
}));
jest.mock('../SocialTemplates', () => ({ SocialTemplates: () => null }));
jest.mock('../SocialDeliveries', () => ({ SocialDeliveries: () => null }));
jest.mock('../SocialFeeds', () => ({ SocialFeeds: () => null }));
jest.mock('../SocialWebhooks', () => ({ SocialWebhooks: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { socialClient } = require('@/lib/studio/social-client') as { socialClient: { confirmConnect: jest.Mock } };

const overview = { accounts: [], templates: [], deliveries: [], webhooks: [], networks: {}, feeds: {}, limits: { webhooks: 5 } } as unknown as SocialOverview;

beforeEach(() => {
  socialClient.confirmConnect.mockReset();
  window.history.replaceState(null, '', '/en/studio/c1/social?confirm=abcdefghijklmnopqrstuvwx');
});

describe('SocialStudio, back from the network', () => {
  it('confirms the connection once, shows it, and drops the one-time id from the address', async () => {
    socialClient.confirmConnect.mockResolvedValue({ ok: true, data: { account: { id: 'a1', network: 'mastodon', handle: 'noor@social.example' } } });
    render(<SocialStudio channelId="c1" locale="en" initial={overview} outcome={{ confirm: 'abcdefghijklmnopqrstuvwx' }} />);
    expect(await screen.findByText('noor@social.example')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Mastodon');
    expect(socialClient.confirmConnect).toHaveBeenCalledTimes(1);
    expect(socialClient.confirmConnect).toHaveBeenCalledWith('c1', 'abcdefghijklmnopqrstuvwx');
    expect(window.location.search).toBe('');
  });

  it('an expired or someone else\'s confirmation says to try again', async () => {
    socialClient.confirmConnect.mockResolvedValue({ ok: false, status: 404, code: 'connect_expired' });
    render(<SocialStudio channelId="c1" locale="en" initial={overview} outcome={{ confirm: 'abcdefghijklmnopqrstuvwx' }} />);
    await waitFor(() => expect(screen.getByText(STUDIO_EN.social.errors.oauth_expired)).toBeInTheDocument());
    expect(screen.getByTestId('accounts')).toBeEmptyDOMElement();
  });

  it('a callback error shows without calling the API', () => {
    render(<SocialStudio channelId="c1" locale="en" initial={overview} outcome={{ error: 'oauth_denied' }} />);
    expect(screen.getByText(STUDIO_EN.social.errors.oauth_denied)).toBeInTheDocument();
    expect(socialClient.confirmConnect).not.toHaveBeenCalled();
  });
});
