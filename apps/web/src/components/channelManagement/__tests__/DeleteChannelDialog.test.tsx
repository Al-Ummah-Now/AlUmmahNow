import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteChannelDialog } from '../DeleteChannelDialog';
import { deleteOwnedChannel } from '@/lib/api/channel-profile';

const push = jest.fn();
const refresh = jest.fn();
const reloadChannels = jest.fn().mockResolvedValue(undefined);
const switchToChannel = jest.fn().mockResolvedValue(undefined);

jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    user: {
      id: 'u1',
      channel: { id: 'main', name: 'Main', userId: 'u1', isMain: true },
      channels: [
        { id: 'main', name: 'Main', userId: 'u1', isMain: true },
        { id: 'second', name: 'Second', userId: 'u1', isMain: false },
      ],
    },
    reloadChannels,
    switchToChannel,
  }),
}));
jest.mock('@/lib/api/channel-profile', () => ({ deleteOwnedChannel: jest.fn() }));

const mockDelete = deleteOwnedChannel as jest.MockedFunction<typeof deleteOwnedChannel>;

describe('DeleteChannelDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires the channel name, sends the chosen new main channel and switches away from the deleted active channel', async () => {
    let resolveDelete: (v: { ok: boolean; newMainChannelId: string | null; status: number }) => void = () => undefined;
    mockDelete.mockReturnValue(new Promise((r) => { resolveDelete = r; }));
    const onOpenChange = jest.fn();
    render(<DeleteChannelDialog channel={{ id: 'main', name: 'Main', isMain: true }} open onOpenChange={onOpenChange} />);

    const confirm = screen.getByTestId('delete-channel-confirm');
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/videos, playlists and community posts are removed/)).toBeInTheDocument();
    expect(screen.getByTestId('delete-channel-new-main')).toHaveValue('second');

    fireEvent.change(screen.getByTestId('delete-channel-confirm-input'), { target: { value: 'Mai' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('delete-channel-confirm-input'), { target: { value: 'Main' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByText('Deleting…')).toBeInTheDocument();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('main', 'second');

    resolveDelete({ ok: true, newMainChannelId: 'second', status: 200 });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/profile?channelDeleted=1'));
    expect(reloadChannels).toHaveBeenCalled();
    expect(switchToChannel).toHaveBeenCalledWith('second');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an error and stays open when the delete fails', async () => {
    mockDelete.mockResolvedValue({ ok: false, newMainChannelId: null, status: 500 });
    render(<DeleteChannelDialog channel={{ id: 'second', name: 'Second' }} open onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByTestId('delete-channel-confirm-input'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByTestId('delete-channel-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be deleted');
    expect(push).not.toHaveBeenCalled();
  });
});
