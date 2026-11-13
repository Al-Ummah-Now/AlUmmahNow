import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BulkEditDialog } from '../BulkEditDialog';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));

describe('BulkEditDialog (Epic 5.3)', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  it('does not submit an empty form', async () => {
    const onApply = jest.fn();
    render(<BulkEditDialog open count={3} onOpenChange={jest.fn()} onApply={onApply} />);
    expect(screen.getByText('Edit 3 videos')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    expect(await screen.findByTestId('bulk-edit-error')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('sends the chosen changes and closes on success', async () => {
    const onApply = jest.fn().mockResolvedValue(true);
    const onOpenChange = jest.fn();
    render(<BulkEditDialog open count={2} onOpenChange={onOpenChange} onApply={onApply} />);
    fireEvent.change(screen.getByTestId('bulk-edit-visibility'), { target: { value: 'public' } });
    fireEvent.change(screen.getByTestId('bulk-edit-add-tags'), { target: { value: 'Tafsir، Seerah' } });
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ isPublic: true, visibility: 'public', addTags: ['Tafsir', 'Seerah'] }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open when the request fails', async () => {
    const onApply = jest.fn().mockResolvedValue(false);
    const onOpenChange = jest.fn();
    render(<BulkEditDialog open count={2} onOpenChange={onOpenChange} onApply={onApply} />);
    fireEvent.change(screen.getByTestId('bulk-edit-visibility'), { target: { value: 'private' } });
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('renders in Arabic, right to left', () => {
    mockLang = 'ar';
    render(<BulkEditDialog open count={2} onOpenChange={jest.fn()} onApply={jest.fn()} />);
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS.bulkEdit;
    expect(screen.getByTestId('bulk-edit-dialog')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('bulk-edit-apply')).toHaveTextContent(ar.apply);
  });
});
