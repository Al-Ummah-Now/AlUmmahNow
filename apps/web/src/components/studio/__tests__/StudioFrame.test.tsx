import { render, screen, within } from '@testing-library/react';
import { StudioFrame } from '../StudioFrame';
import { STUDIO_EN } from '@al-ummah/shared-types';

let pathname = '/en/studio/c1/content/videos';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string }) => <span>{props.alt}</span> }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', isRTL: false }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { id: 'u1', channels: [] }, switchToChannel: jest.fn() }) }));

const mockT = { studio: STUDIO_EN };
const channel = { id: 'c1', name: 'My channel', handle: 'mine' };

function frame(role: 'owner' | 'editor' | 'moderator', extra: Partial<typeof channel & { isHidden: boolean }> = {}) {
  return render(<StudioFrame locale="en" role={role} channel={{ ...channel, ...extra }}><p>page body</p></StudioFrame>);
}

const rail = () => within(screen.getAllByRole('navigation', { name: STUDIO_EN.navLabel })[0]);

describe('StudioFrame', () => {
  beforeEach(() => { pathname = '/en/studio/c1/content/videos'; });

  it('shows the owner every item, linking to the first tab', () => {
    frame('owner');
    expect(rail().getAllByRole('link').map((a) => a.textContent)).toEqual(['Dashboard', 'Content', 'Analytics', 'Playlists', 'Customisation', 'Settings']);
    expect(screen.getByTestId('studio-nav-content')).toHaveAttribute('href', '/en/studio/c1/content/videos');
    // Sections Studio hasn't rebuilt open the channel settings page, never a dead end
    expect(screen.getByTestId('studio-nav-playlists')).toHaveAttribute('href', '/en/settings/channel/c1/playlists');
    expect(screen.getByTestId('studio-nav-settings')).toHaveAttribute('href', '/en/settings/channel/c1');
    expect(screen.getByTestId('studio-tab-posts')).toHaveAttribute('href', '/en/settings/channel/c1/community');
  });

  it('uploads to this channel', () => {
    frame('owner');
    expect(screen.getAllByTestId('studio-upload')[0]).toHaveAttribute('href', '/en/upload?channel=c1');
  });

  it('removes what a role can\'t reach', () => {
    frame('editor');
    expect(rail().getAllByRole('link').map((a) => a.textContent)).toEqual(['Dashboard', 'Content', 'Playlists']);
    expect(screen.queryByTestId('studio-tab-live')).toBeNull();
  });

  it('offers no Upload to a moderator', () => {
    frame('moderator');
    expect(screen.queryByText('Upload')).toBeNull();
    expect(screen.queryByTestId('studio-nav-content')).toBeNull();
  });

  it('marks the current page and tab', () => {
    frame('owner');
    expect(screen.getByTestId('studio-nav-content')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('studio-tab-videos')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('studio-tab-posts')).not.toHaveAttribute('aria-current');
  });

  it('renders the page', () => {
    frame('owner');
    expect(screen.getByRole('main')).toHaveTextContent('page body');
  });

  it('says when the channel is hidden', () => {
    frame('owner', { isHidden: true });
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO_EN.channelHidden);
  });
});
