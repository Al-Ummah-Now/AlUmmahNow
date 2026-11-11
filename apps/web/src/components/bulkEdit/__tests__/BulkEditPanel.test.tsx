import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BulkEditPanel, type BulkPanelVideo } from '../BulkEditPanel';

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

const mockBulkEdit = jest.fn();
const mockUndo = jest.fn();
jest.mock('@/lib/api/videos', () => ({
  bulkEditVideos: (...args: unknown[]) => mockBulkEdit(...args),
  undoBulkEdit: (...args: unknown[]) => mockUndo(...args),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));

const videos: BulkPanelVideo[] = [
  { id: 'v1', title: 'clip one', titleLocalized: { en: 'clip one', ar: 'مقطع' }, channelId: 'ch', originalFilename: 'one.mp4' },
  { id: 'v2', title: 'clip two', channelId: 'ch', originalFilename: 'two.mp4' },
  { id: 'v3', title: 'clip three', channelId: 'ch', originalFilename: 'three.mp4' },
];

const results = (ok: string[], failed: Array<[string, string]> = []) => ({
  success: true,
  results: [...ok.map((id) => ({ videoId: id, success: true, changed: true })), ...failed.map(([id, code]) => ({ videoId: id, success: false, code }))],
  summary: { total: ok.length + failed.length, succeeded: ok.length, failed: failed.length },
});

describe('BulkEditPanel (Studio "Edit selected")', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockBulkEdit.mockReset();
    mockUndo.mockReset();
  });

  it('shows untouched fields as staying as they are, and a live rename preview', () => {
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
    expect(screen.getByTestId('bulk-edit-state-category')).toHaveTextContent('Stays as it is');
    expect(screen.getByTestId('bulk-edit-review')).toBeDisabled();

    fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
    expect(screen.getByTestId('bulk-edit-state-title')).toHaveTextContent('Will change');
    fireEvent.change(screen.getByTestId('rename-pattern'), { target: { value: 'Lesson {n}' } });
    fireEvent.change(screen.getByTestId('rename-pad'), { target: { value: '2' } });
    const after = screen.getAllByTestId('bulk-edit-preview-after').map((el) => el.textContent);
    expect(after).toEqual(['Lesson 01', 'Lesson 02', 'Lesson 03']);

    // Leave the second one out: it keeps its title and the numbering closes up
    fireEvent.click(screen.getAllByTestId('bulk-edit-preview-include')[1]);
    expect(screen.getAllByTestId('bulk-edit-preview-after').map((el) => el.textContent)).toEqual(['Lesson 01', 'clip two', 'Lesson 02']);
  });

  it('flags duplicates and shows Arabic titles right to left', () => {
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
    fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
    fireEvent.click(screen.getByTestId('rename-lang-ar'));
    fireEvent.change(screen.getByTestId('rename-pattern'), { target: { value: 'درس' } });
    const arRows = screen.getAllByTestId('bulk-edit-preview-row').filter((r) => r.getAttribute('data-language') === 'ar');
    expect(arRows).toHaveLength(3);
    expect(arRows.every((r) => r.getAttribute('data-problems')?.includes('duplicate'))).toBe(true);
    expect(within(arRows[0]).getByTestId('bulk-edit-preview-after')).toHaveAttribute('dir', 'rtl');
  });

  it('applies only ticked fields, reports partial failures, retries the failed ones and undoes', async () => {
    mockBulkEdit
      .mockResolvedValueOnce(results(['v1', 'v3'], [['v2', 'forbidden']]))
      .mockResolvedValueOnce(results(['v2']));
    mockUndo.mockResolvedValue(results(['v1', 'v2', 'v3']));
    const onApplied = jest.fn();
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} onApplied={onApplied} />);

    fireEvent.click(screen.getByTestId('bulk-edit-tick-language'));
    fireEvent.click(screen.getByTestId('bulk-edit-language-ar'));
    fireEvent.click(screen.getByTestId('bulk-edit-review'));
    expect(screen.getByTestId('bulk-edit-confirm-language')).toHaveAttribute('data-changes', 'true');
    expect(screen.getByTestId('bulk-edit-confirm-category')).toHaveAttribute('data-changes', 'false');
    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    });

    const result = await screen.findByTestId('bulk-edit-result');
    expect(result).toHaveAttribute('data-succeeded', '2');
    expect(result).toHaveAttribute('data-failed', '1');
    expect(screen.getByTestId('bulk-edit-summary')).toHaveTextContent('2 updated, 1 failed');
    expect(screen.getByTestId('bulk-edit-reasons')).toHaveTextContent('You can’t edit this video (1)');

    const [first] = mockBulkEdit.mock.calls[0];
    expect(first.ids).toEqual(['v1', 'v2', 'v3']);
    expect(first.changes).toEqual({ language: 'ar' });
    expect(first.operationId).toMatch(/^be_/);
    expect(onApplied).toHaveBeenCalledWith(['v1', 'v3']);

    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-edit-retry'));
    });
    await waitFor(() => expect(screen.getByTestId('bulk-edit-result')).toHaveAttribute('data-failed', '0'));
    const [retry] = mockBulkEdit.mock.calls[1];
    expect(retry.ids).toEqual(['v2']);
    expect(retry.operationId).toBe(first.operationId);

    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-edit-undo'));
    });
    expect(await screen.findByTestId('bulk-edit-undone')).toHaveAttribute('data-restored', '3');
    expect(mockUndo).toHaveBeenCalledWith(first.operationId, ['v1', 'v2', 'v3'], { channelId: 'ch' });
  });

  it('sends renamed titles per video and leaves out videos without a new title', async () => {
    mockBulkEdit.mockResolvedValue(results(['v1', 'v3']));
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
    fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
    fireEvent.click(screen.getByTestId('rename-mode-replace'));
    fireEvent.change(screen.getByTestId('rename-find'), { target: { value: 'clip' } });
    fireEvent.change(screen.getByTestId('rename-replace'), { target: { value: 'Part' } });
    fireEvent.click(screen.getAllByTestId('bulk-edit-preview-include')[1]);
    fireEvent.click(screen.getByTestId('bulk-edit-review'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    });
    await screen.findByTestId('bulk-edit-result');
    const [req] = mockBulkEdit.mock.calls[0];
    expect(req.ids).toEqual(['v1', 'v3']);
    expect(req.perVideo).toEqual({ v1: { title: { en: 'Part one' } }, v3: { title: { en: 'Part three' } } });
  });

  it('can be stopped between batches and announces progress', async () => {
    const many: BulkPanelVideo[] = Array.from({ length: 60 }, (_, i) => ({ id: `v${i}`, title: `t${i}`, channelId: 'ch' }));
    let release: () => void = () => undefined;
    mockBulkEdit.mockImplementationOnce((input: { ids: string[] }) => new Promise((resolve) => {
      release = () => resolve(results(input.ids));
    }));
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={many} />);
    fireEvent.click(screen.getByTestId('bulk-edit-tick-comments'));
    fireEvent.click(screen.getByTestId('bulk-edit-review'));
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
    expect(await screen.findByTestId('bulk-edit-running')).toHaveAttribute('data-total', '60');
    fireEvent.click(screen.getByTestId('bulk-edit-stop'));
    await act(async () => {
      release();
    });
    expect(await screen.findByTestId('bulk-edit-cancelled')).toHaveTextContent('25 of 60');
    expect(mockBulkEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('bulk-edit-live')).toHaveTextContent('25 videos updated');
  });

  it('speaks Arabic', () => {
    mockLang = 'ar';
    render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
    expect(screen.getByTestId('bulk-edit-panel-title')).toHaveTextContent(/تعديل (3|٣) من المقاطع/);
    expect(screen.getByTestId('bulk-edit-panel')).toHaveAttribute('dir', 'rtl');
  });
});
