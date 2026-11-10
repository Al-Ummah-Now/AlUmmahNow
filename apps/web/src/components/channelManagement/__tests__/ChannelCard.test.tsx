import { fireEvent, render, screen } from '@testing-library/react';
import type { Channel } from '@al-ummah/shared-types';
import { ChannelCard } from '../ChannelCard';
import { ChannelCardRTL } from '../rtl/ChannelCard';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', dir: 'ltr', isRTL: false }),
}));
jest.mock('@/components/channelManagement/DeleteChannelDialog', () => ({ DeleteChannelDialog: () => null }));

const COVER = 'https://images.alummahnow.net/c_cover.jpeg';
const AVATAR = 'https://images.alummahnow.net/c_avatar.jpeg';
const channel = (over: Partial<Channel> = {}) => ({ id: 'ch1', name: 'Al Ummah Now', userId: 'u1', coverUrl: COVER, avatarUrl: AVATAR, ...over }) as Channel;
const noop = () => {};

describe.each([
  ['LTR', ChannelCard],
  ['RTL', ChannelCardRTL],
])('%s channel card', (_dir, Card) => {
  it('shows the avatar on top of the cover', () => {
    render(<Card channel={channel()} onEdit={noop} onDelete={noop} onView={noop} />);
    expect(screen.getByTestId('channel-card-cover-image')).toHaveAttribute('src', COVER);
    expect(screen.getByTestId('channel-card-avatar-image')).toHaveAttribute('src', AVATAR);
  });

  it('shows the initial when there is no avatar, with or without a cover', () => {
    render(<Card channel={channel({ avatarUrl: undefined })} onEdit={noop} onDelete={noop} onView={noop} />);
    expect(screen.queryByTestId('channel-card-avatar-image')).toBeNull();
    expect(screen.getByTestId('channel-card-avatar')).toHaveTextContent('A');
    expect(screen.getByTestId('channel-card-cover-image')).toBeInTheDocument();
  });

  it('falls back to the initial when the avatar fails to load', () => {
    render(<Card channel={channel({ coverUrl: undefined })} onEdit={noop} onDelete={noop} onView={noop} />);
    expect(screen.queryByTestId('channel-card-cover-image')).toBeNull();
    fireEvent.error(screen.getByTestId('channel-card-avatar-image'));
    expect(screen.queryByTestId('channel-card-avatar-image')).toBeNull();
    expect(screen.getByTestId('channel-card-avatar')).toHaveTextContent('A');
  });
});
