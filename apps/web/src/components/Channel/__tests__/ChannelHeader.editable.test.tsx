/**
 * ChannelHeader: public mode, settings mode and in-place editing mode.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Channel } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { ChannelHeader, type ChannelHeaderEditing } from '../ChannelHeader';
import { ChannelHeader as RtlChannelHeader } from '../rtl/ChannelHeader';

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill: _fill, priority: _priority, unoptimized: _u, ...props }: Record<string, unknown>) => <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, isRTL: false, lang: 'en', locale: 'en', dir: 'ltr' }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { id: 'viewer' }, loading: false }) }));
const mockSubscription = jest.fn();
jest.mock('@/hooks/useChannelSubscription', () => ({
  useChannelSubscription: (opts: { enabled: boolean }) => {
    mockSubscription(opts);
    return { isSubscribed: false, subscriberCount: 1200, isChecking: false, isUpdating: false, error: null, toggle: jest.fn() };
  },
}));
jest.mock('@/components/notifications/ChannelBellMenu', () => ({ ChannelBellMenu: () => null }));
jest.mock('@/components/Channel/ChannelOwnerActions', () => ({ ChannelOwnerActions: () => <div data-testid="channel-owner-actions" /> }));
jest.mock('@/components/ImageCropDialog', () => ({
  __esModule: true,
  default: ({ file, onApply }: { file: File | null; onApply: (f: File) => void }) =>
    file ? <button onClick={() => onApply(new File(['c'], 'cropped.jpg'))}>Apply crop</button> : null,
}));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const channel: Channel = {
  id: 'ch1',
  userId: 'owner',
  name: 'Noor Recitations',
  nameLocalized: { en: 'Noor Recitations', ar: 'تلاوات نور' },
  description: 'Daily recitations',
  handle: 'noor',
  avatarUrl: 'https://cdn.example/avatar.jpg',
  coverUrl: 'https://cdn.example/cover.jpg',
  subscribersCount: 1200,
  videosCount: 34,
  isVerified: true,
} as unknown as Channel;

function editing(overrides: Partial<ChannelHeaderEditing> = {}): ChannelHeaderEditing {
  return {
    active: true,
    name: 'Noor Recitations',
    description: 'Daily recitations',
    handle: 'noor',
    textDir: 'ltr',
    onChange: jest.fn(),
    onImage: jest.fn(),
    avatarUrl: channel.avatarUrl,
    coverUrl: channel.coverUrl,
    ...overrides,
  };
}

describe('ChannelHeader', () => {
  beforeEach(() => mockSubscription.mockClear());

  it('public mode: subscribe button, no editing affordances', () => {
    render(<ChannelHeader channel={channel} locale="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();
    expect(screen.getByTestId('channel-handle')).toHaveTextContent('@noor');
    expect(screen.getByTestId('channel-subscribe-button')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change banner' })).not.toBeInTheDocument();
  });

  it('settings mode: same header without subscribe or owner actions', () => {
    render(<ChannelHeader channel={channel} locale="en" settings />);
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();
    expect(screen.queryByTestId('channel-subscribe-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('channel-owner-actions')).not.toBeInTheDocument();
    expect(mockSubscription).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('editing: banner, avatar, name, handle and description become editable', () => {
    render(<ChannelHeader channel={channel} locale="en" editing={editing()} />);
    expect(screen.getByTestId('channel-header')).toHaveAttribute('data-edit-mode', 'on');
    for (const name of ['Change banner', 'Change channel picture', 'Edit Channel Name', 'Edit Handle', 'Edit Channel Description']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`, 'i') })).toBeInTheDocument();
    }
  });

  it('editing with edit mode off looks like the public header', () => {
    render(<ChannelHeader channel={channel} locale="en" editing={editing({ active: false })} />);
    expect(screen.getByTestId('channel-header')).toHaveAttribute('data-edit-mode', 'off');
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  });

  it('commits a new name in place', () => {
    const e = editing();
    render(<ChannelHeader channel={channel} locale="en" editing={e} />);
    fireEvent.click(screen.getByRole('button', { name: /^Edit Channel Name/i }));
    const input = screen.getByTestId('channel-name-input');
    fireEvent.change(input, { target: { value: '  Noor Academy ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(e.onChange).toHaveBeenCalledWith('name', 'Noor Academy');
  });

  it('reports the handle while typing and shows its status inline', () => {
    const onHandleDraft = jest.fn();
    render(
      <ChannelHeader
        channel={channel}
        locale="en"
        editing={editing({ onHandleDraft, handleInvalid: true, handleStatus: <span>This handle is taken</span> })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Edit Handle/i }));
    const input = screen.getByTestId('channel-handle-input');
    fireEvent.change(input, { target: { value: 'taken handle' } });
    expect(onHandleDraft).toHaveBeenLastCalledWith('takenhandle');
    expect(screen.getByText('This handle is taken')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toBeInTheDocument();
  });

  it('uploads a new banner through the crop step', () => {
    const e = editing();
    render(<ChannelHeader channel={channel} locale="en" editing={e} />);
    fireEvent.change(screen.getByTestId('channel-banner-input'), { target: { files: [new File(['x'], 'b.png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }));
    expect(e.onImage).toHaveBeenCalledWith('cover', expect.any(File));
  });

  it('offers "Add a banner" in edit mode when the channel has none', () => {
    render(<ChannelHeader channel={{ ...channel, coverUrl: undefined } as Channel} locale="en" editing={editing({ coverUrl: undefined })} />);
    expect(screen.getByRole('button', { name: 'Add a banner' })).toBeInTheDocument();
  });

  it('keeps the avatar a fixed square next to long names (#300)', () => {
    render(<ChannelHeader channel={channel} locale="en" editing={editing({ name: 'A very long channel name '.repeat(6) })} />);
    const avatar = screen.getByTestId('channel-avatar-editor');
    expect(avatar.className).toMatch(/aspect-square/);
    expect(avatar.className).toMatch(/flex-shrink-0/);
  });

  it('labels the other language version of the fields', () => {
    render(<ChannelHeader channel={channel} locale="en" editing={editing({ name: 'تلاوات نور', textDir: 'rtl', fieldSuffix: 'Arabic' })} />);
    expect(screen.getByRole('button', { name: /^Edit Channel Name \(Arabic\)/i })).toBeInTheDocument();
    expect(screen.getByTestId('channel-name')).toHaveAttribute('dir', 'rtl');
  });

  it('is right-to-left in Arabic, and the rtl import is the same component', () => {
    expect(RtlChannelHeader).toBe(ChannelHeader);
    render(<ChannelHeader channel={channel} locale="ar" />);
    const header = screen.getByTestId('channel-header');
    expect(header).toHaveAttribute('dir', 'rtl');
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('تلاوات نور');
  });
});
