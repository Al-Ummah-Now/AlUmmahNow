import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudioFeatures } from '@/lib/studio/nav';
import { StudioFrame } from '../StudioFrame';
import { STUDIO_EN } from '@al-ummah/shared-types';

let pathname = '/en/studio/c1/content/videos';
const mockPush = jest.fn();
const mockReload = jest.fn().mockResolvedValue(undefined);
const mockRemove = jest.fn();
let mockRoles: string[] = [];

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string }) => <span>{props.alt}</span> }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', isRTL: false }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { id: 'u1', channels: [] }, switchToChannel: jest.fn(), reloadChannels: mockReload }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { id: 'u1', roles: mockRoles } }) }));
jest.mock('@/lib/runtime-config', () => ({ getCmsUrl: () => 'https://cms.example' }));
jest.mock('@/lib/channels/team', () => ({ removeTeamMember: (...args: unknown[]) => mockRemove(...args) }));

const mockT = { studio: STUDIO_EN, common: { cancel: 'Cancel' } };
const channel = { id: 'c1', name: 'My channel', handle: 'mine' };

function frame(role: 'owner' | 'editor' | 'moderator', extra: Partial<typeof channel & { isHidden: boolean }> = {}, features: StudioFeatures = { live: true, upload: true }) {
  return render(<StudioFrame locale="en" role={role} channel={{ ...channel, ...extra }} features={features}><p>page body</p></StudioFrame>);
}

const rail = () => within(screen.getAllByRole('navigation', { name: STUDIO_EN.navLabel })[0]);

describe('StudioFrame', () => {
  beforeEach(() => {
    pathname = '/en/studio/c1/content/videos';
    mockRoles = [];
    mockPush.mockClear();
    mockRemove.mockReset();
  });

  it('shows the owner every item, linking to the first tab', () => {
    frame('owner', {}, { social: true });
    expect(rail().getAllByRole('link').map((a) => a.textContent)).toEqual(['Dashboard', 'Content', 'Analytics', 'Comments', 'Playlists', 'Customisation', 'Social', 'Settings']);
    expect(screen.getByTestId('studio-nav-social')).toHaveAttribute('href', '/en/studio/c1/social');
    expect(screen.getByTestId('studio-nav-content')).toHaveAttribute('href', '/en/studio/c1/content/videos');
    // Every section is in Studio now; the old channel settings pages redirect here
    expect(screen.getByTestId('studio-nav-playlists')).toHaveAttribute('href', '/en/studio/c1/playlists');
    expect(screen.getByTestId('studio-nav-comments')).toHaveAttribute('href', '/en/studio/c1/comments');
    expect(screen.getByTestId('studio-nav-customisation')).toHaveAttribute('href', '/en/studio/c1/customisation/profile');
    expect(screen.getByTestId('studio-nav-settings')).toHaveAttribute('href', '/en/studio/c1/settings/general');
    expect(screen.getByTestId('studio-tab-posts')).toHaveAttribute('href', '/en/studio/c1/content/posts');
    expect(document.querySelector('a[href*="/settings/channel/"]')).toBeNull();
  });

  it('names the icon-only channel switcher after the channel shown beside it', () => {
    frame('owner');
    const switcher = screen.getAllByTestId('studio-switcher')[0];
    expect(switcher).toHaveAccessibleName(`${STUDIO_EN.switcher.label}: My channel`);
    expect(switcher.className).toMatch(/\bh-11\b/);
    expect(switcher.className).toMatch(/\bw-11\b/);
  });

  it('drawer header: close at the start edge, then the channel, then the switcher, no overlap', async () => {
    frame('owner');
    await userEvent.click(screen.getByTestId('studio-open-menu'));
    const close = await screen.findByTestId('studio-close-menu');
    expect(close).toHaveAccessibleName(STUDIO_EN.closeMenu);
    expect(close.className).toMatch(/\bh-11\b/);
    // Only the drawer's own close button: the dialog's corner close is off
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    const header = close.closest('[data-testid="studio-rail-header"]') as HTMLElement;
    const order = Array.from(header.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
    expect(order.indexOf('studio-close-menu')).toBeLessThan(order.indexOf('studio-channel-name'));
    expect(order.indexOf('studio-channel-name')).toBeLessThan(order.indexOf('studio-switcher'));
    expect(header.querySelector('[data-testid="studio-channel-name"]')).toHaveAttribute('dir', 'auto');
    // The drawer's grid never grows past the drawer for a long name or handle
    expect(close.closest('[data-slot="sheet-content"]')?.className).toMatch(/\bgrid-cols-1\b/);
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

  it('uploads off for the channel (no creator tier): no Upload in the rail', () => {
    frame('owner', {}, { live: true, upload: false });
    expect(screen.queryByTestId('studio-upload')).toBeNull();
  });

  it('offers no Upload to a moderator', () => {
    frame('moderator');
    expect(screen.queryByText('Upload')).toBeNull();
    // Content opens on Live, the only tab a moderator has
    expect(screen.getByTestId('studio-nav-content')).toHaveAttribute('href', '/en/studio/c1/content/live');
  });

  it('live off for the channel: no Go live in the rail and no Live tab', () => {
    pathname = '/en/studio/c1/content/videos';
    frame('owner', {}, { live: false });
    expect(screen.queryByTestId('studio-golive-link')).toBeNull();
    expect(screen.queryByTestId('studio-tab-live')).toBeNull();
  });

  it('live on: Go live in the rail', () => {
    frame('owner');
    expect(screen.getAllByTestId('studio-golive-link')[0]).toHaveAttribute('href', '/en/studio/c1/content/live');
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

  it('offers Write article and My articles to a scholar only', () => {
    frame('owner');
    expect(screen.queryByTestId('studio-write-article')).toBeNull();
    expect(screen.queryByTestId('studio-nav-articles')).toBeNull();
  });

  it('opens the CMS editor for a scholar', () => {
    mockRoles = ['Scholar'];
    frame('editor');
    expect(screen.getAllByTestId('studio-write-article')[0]).toHaveAttribute('href', 'https://cms.example/posts/new?locale=en&lang=en');
    expect(screen.getAllByTestId('studio-nav-articles')[0]).toHaveAttribute('href', 'https://cms.example/posts?lang=en');
  });

  it('never offers the owner Leave', async () => {
    frame('owner');
    await userEvent.click(screen.getAllByTestId('studio-switcher')[0]);
    expect(screen.queryByTestId('studio-leave-channel')).toBeNull();
  });

  it('lets a member leave after confirming in the in-app dialog', async () => {
    mockRemove.mockResolvedValue(undefined);
    frame('editor');
    await userEvent.click(screen.getAllByTestId('studio-switcher')[0]);
    await userEvent.click(await screen.findByTestId('studio-leave-channel'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(STUDIO_EN.switcher.leaveTitle.replace('{channel}', 'My channel'));
    await userEvent.click(within(dialog).getByRole('button', { name: STUDIO_EN.switcher.leaveConfirm }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/studio'));
    expect(mockRemove).toHaveBeenCalledWith('c1', 'u1');
    expect(mockReload).toHaveBeenCalled();
  });

  it('says when leaving failed and stays', async () => {
    mockRemove.mockRejectedValue(new Error('nope'));
    frame('editor');
    await userEvent.click(screen.getAllByTestId('studio-switcher')[0]);
    await userEvent.click(await screen.findByTestId('studio-leave-channel'));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: STUDIO_EN.switcher.leaveConfirm }));
    expect((await screen.findAllByTestId('studio-leave-error'))[0]).toHaveTextContent(STUDIO_EN.switcher.leaveFailed);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
