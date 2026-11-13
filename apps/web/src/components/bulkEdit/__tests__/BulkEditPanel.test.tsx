import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BulkEditPanel, type BulkPanelVideo } from '../BulkEditPanel';
import { registerTranslator } from '@/lib/i18n/translate-text';

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
const mockGetPlaylist = jest.fn();
const mockReorder = jest.fn();
jest.mock('@/lib/api/playlists', () => ({
  getPlaylistById: (...args: unknown[]) => mockGetPlaylist(...args),
  reorderPlaylistVideos: (...args: unknown[]) => mockReorder(...args),
}));

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
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
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
    fireEvent.change(screen.getByTestId('rename-pattern-ar'), { target: { value: 'درس' } });
    const arRows = screen.getAllByTestId('bulk-edit-preview-cell').filter((r) => r.getAttribute('data-language') === 'ar');
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
    fireEvent.click(screen.getByTestId('rename-mode-replace-en'));
    fireEvent.change(screen.getByTestId('rename-find-en'), { target: { value: 'clip' } });
    fireEvent.change(screen.getByTestId('rename-replace-en'), { target: { value: 'Part' } });
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
    expect(screen.getByTestId('bulk-edit-panel-title')).toHaveTextContent(/تعديل (3|٣) من المرئيات/);
    expect(screen.getByTestId('bulk-edit-panel')).toHaveAttribute('dir', 'rtl');
  });

  describe('order of the rename', () => {
    const afterTexts = () => screen.getAllByTestId('bulk-edit-preview-after').map((el) => el.textContent);
    const rowIds = () => screen.getAllByTestId('bulk-edit-preview-row').map((el) => el.getAttribute('data-id'));

    function renameLessons() {
      fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
      fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
    }

    it('sorts by title (natural) both ways; numbers follow the order shown', () => {
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      renameLessons();
      expect(rowIds()).toEqual(['v1', 'v2', 'v3']);
      fireEvent.change(screen.getByTestId('bulk-edit-preview-order-key'), { target: { value: 'title' } });
      expect(rowIds()).toEqual(['v1', 'v3', 'v2']);
      expect(afterTexts()).toEqual(['Lesson 1', 'Lesson 2', 'Lesson 3']);
      fireEvent.click(screen.getByTestId('bulk-edit-preview-order-dir'));
      expect(rowIds()).toEqual(['v2', 'v3', 'v1']);
    });

    it('the direction button re-sorts at once, flips its icon and label, even when the values tie or are missing', () => {
      const same: BulkPanelVideo[] = [
        { id: 'p', title: 'Lecture', channelId: 'ch' },
        { id: 'q', title: 'Lecture', channelId: 'ch' },
        { id: 'r', title: 'Lecture', channelId: 'ch' },
      ];
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={same} />);
      renameLessons();
      const dir = screen.getByTestId('bulk-edit-preview-order-dir');
      for (const key of ['list', 'title', 'uploaded', 'duration']) {
        fireEvent.change(screen.getByTestId('bulk-edit-preview-order-key'), { target: { value: key } });
        expect(rowIds()).toEqual(['p', 'q', 'r']);
        expect(dir).toHaveAttribute('aria-label', 'Ascending');
        fireEvent.click(dir);
        expect(rowIds()).toEqual(['r', 'q', 'p']);
        expect(afterTexts()).toEqual(['Lesson 1', 'Lesson 2', 'Lesson 3']);
        expect(dir).toHaveAttribute('aria-label', 'Descending');
        expect(dir).toHaveAttribute('data-dir', 'desc');
        expect(screen.getByTestId('bulk-edit-preview-order-dir-icon')).toHaveAttribute('data-icon', 'desc');
        fireEvent.click(dir);
        expect(rowIds()).toEqual(['p', 'q', 'r']);
      }
      // Nothing to sort by: offered disabled, and the ones without a value are named
      const option = (v: string) => screen.getByTestId('bulk-edit-preview-order-key').querySelector(`option[value="${v}"]`) as HTMLOptionElement;
      expect(option('filename').disabled).toBe(true);
      expect(option('filename')).toHaveTextContent('File name (none to sort by)');
      expect(option('title').disabled).toBe(false);
    });

    it('says how many have nothing to sort by', () => {
      const mixed: BulkPanelVideo[] = [
        { id: 'p', title: 'a', channelId: 'ch', duration: 20 },
        { id: 'q', title: 'b', channelId: 'ch' },
        { id: 'r', title: 'c', channelId: 'ch', duration: 10 },
      ];
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={mixed} />);
      renameLessons();
      fireEvent.change(screen.getByTestId('bulk-edit-preview-order-key'), { target: { value: 'duration' } });
      expect(rowIds()).toEqual(['r', 'p', 'q']);
      expect(screen.getByTestId('bulk-edit-preview-order-missing')).toHaveTextContent('1 have no “Duration” and stay at the end.');
      fireEvent.click(screen.getByTestId('bulk-edit-preview-order-dir'));
      expect(rowIds()).toEqual(['p', 'r', 'q']);
    });

    it('after a move by hand, says sorting replaces it; the direction button re-sorts by the field', () => {
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      renameLessons();
      fireEvent.change(screen.getByTestId('bulk-edit-preview-order-key'), { target: { value: 'title' } });
      expect(screen.queryByTestId('bulk-edit-preview-order-manual')).toBeNull();
      fireEvent.click(screen.getAllByTestId('bulk-edit-preview-up')[2]);
      expect(rowIds()).toEqual(['v1', 'v2', 'v3']);
      expect(screen.getByTestId('bulk-edit-preview-order-manual')).toHaveTextContent('You moved rows by hand');
      expect(screen.getByTestId('bulk-edit-preview-order-dir')).toHaveAttribute('aria-describedby', 'bulk-edit-preview-order-manual');
      fireEvent.click(screen.getByTestId('bulk-edit-preview-order-dir'));
      expect(rowIds()).toEqual(['v2', 'v3', 'v1']);
      expect(screen.getByTestId('bulk-edit-preview-order-key')).toHaveValue('title');
      expect(screen.queryByTestId('bulk-edit-preview-order-manual')).toBeNull();
    });

    it('names the direction in Arabic', () => {
      mockLang = 'ar';
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
      const dir = screen.getByTestId('bulk-edit-preview-order-dir');
      expect(dir).toHaveAttribute('aria-label', 'تصاعدي');
      fireEvent.click(dir);
      expect(dir).toHaveAttribute('aria-label', 'تنازلي');
      expect(rowIds()).toEqual(['v3', 'v2', 'v1']);
    });

    it('moves a row with Alt+arrow keys and the arrow buttons, and announces it', () => {
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      renameLessons();
      fireEvent.keyDown(screen.getAllByTestId('bulk-edit-preview-handle')[0], { key: 'ArrowDown', altKey: true });
      expect(rowIds()).toEqual(['v2', 'v1', 'v3']);
      expect(screen.getByTestId('bulk-edit-preview-moved')).toHaveTextContent('Moved to position 2 of 3');
      expect(screen.getByTestId('bulk-edit-preview-order-key')).toHaveValue('');
      expect(afterTexts()[0]).toBe('Lesson 1');
      // A plain arrow key does nothing
      fireEvent.keyDown(screen.getAllByTestId('bulk-edit-preview-handle')[0], { key: 'ArrowDown' });
      expect(rowIds()).toEqual(['v2', 'v1', 'v3']);
      fireEvent.click(screen.getAllByTestId('bulk-edit-preview-up')[2]);
      expect(rowIds()).toEqual(['v2', 'v3', 'v1']);
      expect(screen.getAllByTestId('bulk-edit-preview-up')[0]).toBeDisabled();
      expect(screen.getAllByTestId('bulk-edit-preview-down')[2]).toBeDisabled();
    });

    it('sends the videos in the chosen order with their numbers', async () => {
      mockBulkEdit.mockResolvedValue(results(['v3', 'v1', 'v2']));
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      renameLessons();
      fireEvent.click(screen.getAllByTestId('bulk-edit-preview-up')[2]);
      fireEvent.click(screen.getAllByTestId('bulk-edit-preview-up')[1]);
      expect(rowIds()).toEqual(['v3', 'v1', 'v2']);
      fireEvent.click(screen.getByTestId('bulk-edit-review'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('bulk-edit-apply'));
      });
      await screen.findByTestId('bulk-edit-result');
      const [req] = mockBulkEdit.mock.calls[0];
      expect(req.ids).toEqual(['v3', 'v1', 'v2']);
      expect(req.perVideo).toEqual({ v3: { title: { en: 'Lesson 1' } }, v1: { title: { en: 'Lesson 2' } }, v2: { title: { en: 'Lesson 3' } } });
    });

    it('continues the numbering after the highest existing number', async () => {
      const load = jest.fn().mockResolvedValue(['Lesson 35', 'Lesson ٣٦', 'Other 99']);
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} loadExistingTitles={load} />);
      renameLessons();
      await act(async () => {
        fireEvent.click(screen.getByTestId('bulk-edit-preview-continue'));
      });
      expect(await screen.findByTestId('bulk-edit-preview-continue-result')).toHaveAttribute('data-found', '36');
      fireEvent.click(screen.getByTestId('bulk-edit-preview-continue-use'));
      expect(afterTexts()).toEqual(['Lesson 37', 'Lesson 38', 'Lesson 39']);
      expect(screen.getByTestId('rename-start')).toHaveValue(37);
    });

    it('also orders the videos in the playlist they are added to', async () => {
      mockBulkEdit.mockResolvedValue(results(['v2', 'v1', 'v3']));
      mockGetPlaylist.mockResolvedValue({ id: 'p1', videos: ['x', 'v1', 'y'], sortMode: 'manual' });
      mockReorder.mockResolvedValue({ ok: true, data: { videos: [] } });
      const playlists = { list: [{ id: 'p1', title: 'P', name: 'P', isPublic: true, videos: [] }], create: jest.fn() } as never;
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} playlists={playlists} />);
      renameLessons();
      fireEvent.click(screen.getAllByTestId('bulk-edit-preview-up')[1]);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-playlists'));
      fireEvent.click(screen.getByTestId('bulk-edit-playlists-add-toggle'));
      fireEvent.click(screen.getAllByTestId('bulk-edit-playlists-add-option')[0].querySelector('input') as HTMLInputElement);
      fireEvent.click(screen.getByTestId('bulk-edit-playlist-order'));
      fireEvent.click(screen.getByTestId('bulk-edit-review'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('bulk-edit-apply'));
      });
      expect(await screen.findByTestId('bulk-edit-playlist-order-result')).toHaveTextContent('Ordered in the playlist too.');
      expect(mockReorder).toHaveBeenCalledWith('p1', ['x', 'v2', 'v1', 'v3', 'y'], { channelId: 'ch' });
    });
  });

  describe('English and Arabic at the same time, to different values', () => {
    const cells = (lang: 'en' | 'ar') => screen.getAllByTestId('bulk-edit-preview-after').filter((el) => el.getAttribute('data-language') === lang).map((el) => el.textContent);

    it('renames both titles in one pass with their own patterns and one shared number', async () => {
      mockBulkEdit.mockResolvedValue(results(['v1', 'v2', 'v3']));
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
      fireEvent.click(screen.getByTestId('rename-lang-ar'));
      fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
      fireEvent.change(screen.getByTestId('rename-pattern-ar'), { target: { value: 'الدرس {n}' } });
      fireEvent.change(screen.getByTestId('rename-start'), { target: { value: '10' } });
      fireEvent.click(screen.getByTestId('rename-digits-arabic-indic'));
      expect(screen.getByTestId('rename-pattern-ar')).toHaveAttribute('dir', 'rtl');
      expect(screen.getByTestId('rename-pattern-ar')).toHaveAttribute('lang', 'ar');
      expect(screen.getByTestId('rename-pattern-en')).toHaveAttribute('dir', 'ltr');
      expect(cells('en')).toEqual(['Lesson 10', 'Lesson 11', 'Lesson 12']);
      expect(cells('ar')).toEqual(['الدرس ١٠', 'الدرس ١١', 'الدرس ١٢']);

      fireEvent.click(screen.getByTestId('bulk-edit-review'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('bulk-edit-apply'));
      });
      await screen.findByTestId('bulk-edit-result');
      const [req] = mockBulkEdit.mock.calls[0];
      expect(req.perVideo).toEqual({
        v1: { title: { en: 'Lesson 10', ar: 'الدرس ١٠' } },
        v2: { title: { en: 'Lesson 11', ar: 'الدرس ١١' } },
        v3: { title: { en: 'Lesson 12', ar: 'الدرس ١٢' } },
      });
    });

    it('finds and replaces in one language while the other keeps its own rule, or stays untouched', () => {
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
      fireEvent.click(screen.getByTestId('rename-mode-replace-en'));
      fireEvent.change(screen.getByTestId('rename-find-en'), { target: { value: 'clip' } });
      fireEvent.change(screen.getByTestId('rename-replace-en'), { target: { value: 'Part' } });
      expect(cells('en')).toEqual(['Part one', 'Part two', 'Part three']);
      expect(cells('ar')).toEqual([]);
      fireEvent.click(screen.getByTestId('rename-lang-ar'));
      fireEvent.click(screen.getByTestId('rename-mode-affix-ar'));
      fireEvent.change(screen.getByTestId('rename-prefix-ar'), { target: { value: 'سلسلة: ' } });
      expect(cells('ar')[0]).toBe('سلسلة: مقطع');
      expect(cells('en')[0]).toBe('Part one');
    });

    it('sets both descriptions side by side, each with its own way', async () => {
      mockBulkEdit.mockResolvedValue(results(['v1', 'v2', 'v3']));
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-description'));
      fireEvent.click(screen.getByTestId('bulk-edit-desc-ar-enabled'));
      fireEvent.change(screen.getByTestId('bulk-edit-desc-en-text'), { target: { value: 'Footer' } });
      fireEvent.click(screen.getByTestId('bulk-edit-desc-ar-replace'));
      fireEvent.change(screen.getByTestId('bulk-edit-desc-ar-text'), { target: { value: 'وصف جديد' } });
      expect(screen.getByTestId('bulk-edit-desc-ar-text')).toHaveAttribute('dir', 'rtl');
      fireEvent.click(screen.getByTestId('bulk-edit-review'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('bulk-edit-apply'));
      });
      await screen.findByTestId('bulk-edit-result');
      expect(mockBulkEdit.mock.calls[0][0].changes).toEqual({ description: { en: { mode: 'append', text: 'Footer' }, ar: { mode: 'replace', text: 'وصف جديد' } } });
    });

    it('offers Translate only once a translator is registered', async () => {
      render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos} />);
      fireEvent.click(screen.getByTestId('bulk-edit-tick-title'));
      fireEvent.click(screen.getByTestId('rename-lang-ar'));
      expect(screen.queryByTestId('rename-pair-translate-ar')).toBeNull();
      act(() => registerTranslator(async (text, from, to) => (from === 'en' && to === 'ar' ? text.replace('Lesson', 'الدرس') : text)));
      fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('rename-pair-translate-ar'));
      });
      expect(screen.getByTestId('rename-pattern-ar')).toHaveValue('الدرس {n}');
      act(() => registerTranslator(null));
    });
  });
});

