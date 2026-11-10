/**
 * The upload page's channel picker: one channel is a read-only card, several
 * are an accessible combobox (avatar, name, @handle, grouped by owned and
 * managed) that filters as you type, and a locked picker can't change.
 * English and Arabic.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UploadChannelPicker } from '../UploadChannelPicker';
import type { UploadChannelCandidate } from '@/lib/upload/upload-channel';

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

const ME = 'u-me';
const MINE: UploadChannelCandidate = { id: 'c1', userId: ME, name: 'Halaqa Notes', handle: 'halaqa', avatarUrl: 'https://img.example/a.png', role: 'owner' };
const OTHER: UploadChannelCandidate = { id: 'c2', userId: 'u-x', name: 'Masjid Daily', nameLocalized: { ar: 'المسجد يوميا' }, handle: 'masjid', role: 'editor' };
const THIRD: UploadChannelCandidate = { id: 'c3', userId: ME, name: 'Quran Circle', handle: 'quran', role: 'owner' };

function Harness({ channels, disabled = false, onChange }: { channels: UploadChannelCandidate[]; disabled?: boolean; onChange?: jest.Mock }) {
  const [value, setValue] = useState(channels[0]?.id ?? null);
  return (
    <UploadChannelPicker
      channels={channels}
      value={value}
      userId={ME}
      disabled={disabled}
      onChange={(id) => {
        onChange?.(id);
        setValue(id);
      }}
    />
  );
}

beforeEach(() => {
  mockLang = 'en';
});

describe('UploadChannelPicker', () => {
  it('renders nothing without channels', () => {
    const { container } = render(<Harness channels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one channel as a fixed, read-only card with avatar, name and @handle', () => {
    render(<Harness channels={[MINE]} />);
    const picker = screen.getByTestId('upload-channel-picker');
    expect(picker).toHaveAttribute('data-mode', 'fixed');
    expect(picker).toHaveAttribute('data-channel-id', 'c1');
    expect(screen.getByRole('heading', { name: 'Channel' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-channel-name')).toHaveTextContent('Halaqa Notes');
    expect(screen.getByTestId('upload-channel-handle')).toHaveTextContent('@halaqa');
    expect(within(picker).getByText('Uploading to Halaqa Notes')).toBeInTheDocument();
    expect(picker.querySelector('img')).toHaveAttribute('src', 'https://img.example/a.png');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('lists every channel in a combobox, grouped, and picks one', () => {
    const onChange = jest.fn();
    render(<Harness channels={[MINE, OTHER, THIRD]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Choose the channel to upload to' });
    fireEvent.focus(input);
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    expect(within(listbox).getByRole('group', { name: 'Channels you manage' })).toBeInTheDocument();
    expect(within(listbox).getByText(/@masjid · Editor/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('upload-channel-option-c2'));
    expect(onChange).toHaveBeenCalledWith('c2');
    expect(screen.getByTestId('upload-channel-picker')).toHaveAttribute('data-channel-id', 'c2');
    expect(screen.getByTestId('upload-channel-role')).toHaveAttribute('data-role', 'editor');
  });

  it('filters as you type, by name or @handle', () => {
    render(<Harness channels={[MINE, OTHER, THIRD]} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'quran' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Quran Circle')]);
    fireEvent.change(input, { target: { value: '@masj' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  });

  it('is disabled while an upload runs, and says why', () => {
    const onChange = jest.fn();
    render(<Harness channels={[MINE, OTHER]} disabled onChange={onChange} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByTestId('upload-channel-locked')).toHaveTextContent('once the current upload finishes');
    expect(screen.getByTestId('upload-channel-picker')).toHaveAttribute('data-disabled', 'true');
  });

  it('speaks Arabic, with localized channel names and the handle kept left-to-right', () => {
    mockLang = 'ar';
    render(<Harness channels={[OTHER, MINE]} />);
    expect(screen.getByRole('heading', { name: 'القناة' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-channel-name')).toHaveTextContent('المسجد يوميا');
    expect(screen.getByTestId('upload-channel-handle').querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('combobox', { name: 'اختر القناة التي ترفع إليها' })).toBeInTheDocument();
  });
});
