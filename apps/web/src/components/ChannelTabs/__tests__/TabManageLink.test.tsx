import { render, screen } from '@testing-library/react';
import { TabManageLink } from '../TabManageLink';
import { ChannelViewerProvider } from '@/components/Channel/ChannelViewerContext';
import { useOptionalMultiAccount } from '@/hooks/useMultiAccount';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useOptionalMultiAccount: jest.fn(() => null) }));
const mockAccount = useOptionalMultiAccount as jest.Mock;

const CH = 'ch-1';
function asMember(role: string | null) {
  mockAccount.mockReturnValue({ user: { channels: role ? [{ id: CH, role }] : [] } });
}
function renderTab(tab: Parameters<typeof TabManageLink>[0]['tab'], isOwner = false) {
  return render(
    <ChannelViewerProvider channelId={CH} isOwner={isOwner}>
      <TabManageLink channelId={CH} tab={tab} />
    </ChannelViewerProvider>
  );
}

describe('TabManageLink', () => {
  beforeEach(() => mockAccount.mockReturnValue(null));

  it('shows visitors nothing', () => {
    const { container } = renderTab('videos');
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['home', '/en/settings/channel/ch-1/sections'],
    ['videos', '/en/settings/channel/ch-1/videos'],
    ['shorts', '/en/settings/channel/ch-1/videos'],
    ['live', '/en/settings/channel/ch-1/videos'],
    ['playlists', '/en/settings/channel/ch-1/playlists'],
    ['community', '/en/settings/channel/ch-1/community'],
    ['channels', '/en/settings/channel/ch-1/sections'],
    ['about', '/en/settings/channel/ch-1/edit'],
  ] as const)('gives the owner a manage link on %s', (tab, href) => {
    renderTab(tab, true);
    expect(screen.getByTestId('tab-manage-link')).toHaveAttribute('href', href);
  });

  it('follows the member role: an editor manages videos but not owner-only playlists', () => {
    asMember('editor');
    const videos = renderTab('videos');
    expect(screen.getByTestId('tab-manage-link')).toHaveAttribute('href', '/en/settings/channel/ch-1/videos');
    videos.unmount();
    const { container } = renderTab('playlists');
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for a role on another channel', () => {
    mockAccount.mockReturnValue({ user: { channels: [{ id: 'other', role: 'owner' }] } });
    const { container } = renderTab('home');
    expect(container).toBeEmptyDOMElement();
  });
});
