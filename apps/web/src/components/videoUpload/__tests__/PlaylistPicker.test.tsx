/**
 * Upload page playlists: pick several with search, create one inline (name,
 * visibility, description) and it is selected at once; batch rows follow the
 * batch or have their own; notices never show raw errors. English and Arabic.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlaylistPicker } from '../PlaylistPicker';
import { BatchRowPlaylists } from '../BatchRowPlaylists';
import { PlaylistAddNotices } from '../PlaylistAddNotices';
import type { PlaylistWithVideos } from '@/lib/api/playlists';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      locale: mockLang,
      dir: isAr ? 'rtl' : 'ltr',
      isRTL: isAr,
    };
  },
}));

const pl = (id: string, title: string, extra: Partial<PlaylistWithVideos> = {}) => ({ id, title, name: title, videos: [], isPublic: true, ...extra } as unknown as PlaylistWithVideos);
const LIST = [pl('p1', 'Tafsir Juz Amma'), pl('p2', 'Seerah', { isPublic: false }), pl('p3', 'Fiqh of Salah')];

function Harness({ onCreate, initial = [] as string[], locked = false }: { onCreate?: jest.Mock; initial?: string[]; locked?: boolean }) {
  const [list, setList] = useState(LIST);
  const [selected, setSelected] = useState<string[]>(initial);
  const create = async (input: { title: string; description?: string; isPublic: boolean }) => {
    const made = await (onCreate ?? jest.fn())(input);
    if (made) setList((prev) => [made, ...prev]);
    return made;
  };
  return (
    <>
      <PlaylistPicker label="Playlists" playlists={list} selected={selected} onChange={setSelected} onCreate={create} locked={locked} />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
}

beforeEach(() => {
  mockLang = 'en';
});

describe('PlaylistPicker', () => {
  it('picks several playlists, with search, and removes one from its chip', () => {
    render(<Harness />);
    expect(screen.getByText('No playlists')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('playlist-picker-toggle'));
    const panel = screen.getByTestId('playlist-picker-panel');
    fireEvent.click(within(panel).getByLabelText('Tafsir Juz Amma'));
    fireEvent.change(screen.getByTestId('playlist-picker-search'), { target: { value: 'seer' } });
    expect(within(panel).queryByLabelText('Tafsir Juz Amma')).toBeNull();
    fireEvent.click(within(panel).getByLabelText('Seerah'));
    expect(screen.getByTestId('selected')).toHaveTextContent('p1,p2');
    expect(screen.getByTestId('playlist-picker-toggle')).toHaveTextContent('2 selected');
    fireEvent.change(screen.getByTestId('playlist-picker-search'), { target: { value: 'zzz' } });
    expect(within(panel).getByText('No playlists match your search')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tafsir Juz Amma' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('p2');
  });

  it('creates a playlist inline with visibility and description, and selects it at once', async () => {
    const onCreate = jest.fn(async (input: { title: string }) => pl('new1', input.title, { isPublic: false }));
    render(<Harness onCreate={onCreate} initial={['p3']} />);
    fireEvent.click(screen.getByTestId('playlist-picker-toggle'));
    fireEvent.click(screen.getByTestId('playlist-picker-new'));
    fireEvent.click(screen.getByTestId('playlist-picker-create'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a playlist name');
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('playlist-picker-name'), { target: { value: '  Ramadan   2026 ' } });
    fireEvent.click(screen.getByTestId('playlist-picker-visibility-private'));
    fireEvent.change(screen.getByTestId('playlist-picker-description'), { target: { value: ' Nightly reminders ' } });
    fireEvent.click(screen.getByTestId('playlist-picker-create'));
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('p3,new1'));
    expect(onCreate).toHaveBeenCalledWith({ title: 'Ramadan 2026', description: 'Nightly reminders', isPublic: false });
    expect(screen.getByTestId('playlist-picker-message')).toHaveTextContent('Created "Ramadan 2026" and selected it');
    expect(screen.queryByTestId('playlist-picker-create-form')).toBeNull();
  });

  it('shows a friendly message when the playlist was not created', async () => {
    const onCreate = jest.fn(async () => null);
    render(<Harness onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('playlist-picker-toggle'));
    fireEvent.click(screen.getByTestId('playlist-picker-new'));
    fireEvent.change(screen.getByTestId('playlist-picker-name'), { target: { value: 'Duas' } });
    fireEvent.click(screen.getByTestId('playlist-picker-create'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create the playlist. Please try again.');
    expect(screen.getByTestId('selected')).toHaveTextContent('');
  });

  it('once the adds were requested, shows the playlists and changes nothing', () => {
    render(<Harness initial={['p1']} locked />);
    expect(screen.queryByTestId('playlist-picker-toggle')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByTestId('playlist-picker-locked')).toHaveTextContent('Playlists are set: the upload has started.');
  });

  it('works in Arabic (RTL)', () => {
    mockLang = 'ar';
    render(<Harness initial={['p2']} />);
    const picker = screen.getByTestId('playlist-picker');
    expect(picker).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('playlist-picker-toggle')).toHaveTextContent('اختر قوائم التشغيل');
    expect(screen.getByLabelText('خاصة')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('playlist-picker-toggle'));
    fireEvent.click(screen.getByTestId('playlist-picker-new'));
    expect(screen.getByText('الوصف (اختياري)')).toBeInTheDocument();
  });
});

describe('BatchRowPlaylists', () => {
  it("follows the batch until the row chooses its own, and can go back", () => {
    const onOverride = jest.fn();
    const { rerender } = render(
      <BatchRowPlaylists rowId="r1" playlists={LIST} loading={false} failed={false} batch={['p1']} override={undefined} onOverride={onOverride} onCreate={jest.fn()} />,
    );
    expect(screen.getByTestId('batch-row-playlists')).toHaveAttribute('data-mode', 'batch');
    expect(screen.getByText('Playlists · Same as the batch')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-row-playlist-picker-toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('batch-row-playlists-mode'));
    expect(onOverride).toHaveBeenCalledWith(['p1']);

    rerender(<BatchRowPlaylists rowId="r1" playlists={LIST} loading={false} failed={false} batch={['p1']} override={['p3']} onOverride={onOverride} onCreate={jest.fn()} />);
    expect(screen.getByTestId('batch-row-playlists')).toHaveAttribute('data-mode', 'own');
    expect(screen.getByTestId('batch-row-playlist-picker-toggle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Use the batch playlists'));
    expect(onOverride).toHaveBeenLastCalledWith(undefined);

    rerender(<BatchRowPlaylists rowId="r1" playlists={LIST} loading={false} failed={false} batch={['p1']} override={['p3']} committed={['p3']} onOverride={onOverride} onCreate={jest.fn()} />);
    expect(screen.getByTestId('batch-row-playlists')).toHaveAttribute('data-mode', 'locked');
    expect(screen.queryByTestId('batch-row-playlists-mode')).toBeNull();
  });
});

describe('PlaylistAddNotices', () => {
  it("says which playlist an add is being retried for, in the uploader's words", () => {
    render(<PlaylistAddNotices playlists={LIST} notices={[{ playlistId: 'p1', kind: 'retrying', count: 2 }, { playlistId: 'p2', kind: 'failed', count: 1 }]} />);
    const notices = screen.getAllByTestId('playlist-add-notice');
    expect(notices[0]).toHaveTextContent(`Couldn't add 2 videos to "Tafsir Juz Amma" yet; we'll retry.`);
    expect(notices[1]).toHaveTextContent(`The video wasn't added to "Seerah". You can add it from the video's page.`);
  });

  it('in Arabic', () => {
    mockLang = 'ar';
    render(<PlaylistAddNotices playlists={LIST} notices={[{ playlistId: 'p1', kind: 'retrying', count: 1 }]} />);
    expect(screen.getByTestId('playlist-add-notice')).toHaveTextContent('تعذّرت إضافة المرئي إلى «Tafsir Juz Amma» حتى الآن؛ سنعيد المحاولة.');
  });

  it('renders nothing without notices', () => {
    const { container } = render(<PlaylistAddNotices playlists={LIST} notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
