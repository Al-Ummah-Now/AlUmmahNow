import { render, screen } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { SocialAccounts } from '../SocialAccounts';
import type { SocialOverview } from '@/lib/studio/social';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: STUDIO_EN } }) }));
jest.mock('@/lib/studio/social-client', () => ({ socialClient: {} }));
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: jest.fn(), dialog: null }) }));

const off = { available: false, configured: false };
const on = { available: true, configured: true };

describe('SocialAccounts, networks the site has not set up', () => {
  it('shows only the networks people can connect: no "not available" text, no disabled button', () => {
    const networks = { x: off, telegram: on, bluesky: { available: false, configured: true }, mastodon: on } as SocialOverview['networks'];
    render(<SocialAccounts channelId="c1" locale="en" accounts={[]} networks={networks} onAccounts={() => {}} />);
    expect(screen.queryByTestId('social-network-x')).toBeNull();
    expect(screen.queryByTestId('social-network-bluesky')).toBeNull();
    expect(screen.getByTestId('social-network-telegram')).toBeInTheDocument();
    expect(screen.getByTestId('social-connect-mastodon')).toBeEnabled();
    expect(screen.queryByText(/not available|paused by the site/i)).toBeNull();
  });

  it('no network at all: no empty list', () => {
    const networks = { x: off, telegram: off, bluesky: off, mastodon: off } as SocialOverview['networks'];
    render(<SocialAccounts channelId="c1" locale="en" accounts={[]} networks={networks} onAccounts={() => {}} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
