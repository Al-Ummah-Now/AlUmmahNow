import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UploadQueueItem } from '@al-ummah/shared-types';
import { useBatchSetValues, useSetValuesSeed } from '../useBatchSetValues';

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

let mockTermsAccepted: boolean | undefined = true;
const mockMark = jest.fn();
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { termsAccepted: mockTermsAccepted } }),
  needsCreatorTerms: (c: { access: { termsAccepted?: boolean } }) => c.access.termsAccepted === false,
  markCreatorTermsRequired: () => { mockTermsAccepted = false; mockMark(); },
}));
const mockUpdate = jest.fn();
jest.mock('@/lib/api/videos', () => ({
  updateVideo: (...args: unknown[]) => mockUpdate(...args),
}));
const mockSchedule = jest.fn();
jest.mock('@/lib/api/upload-client', () => ({
  scheduleUploadedVideo: (...args: unknown[]) => mockSchedule(...args),
}));

function row(id: string, name: string, overrides: Partial<UploadQueueItem> = {}): UploadQueueItem {
  return {
    id,
    file: new File(['x'], name, { type: 'video/mp4' }),
    videoId: `vid-${id}`,
    metadata: { title: name } as UploadQueueItem['metadata'],
    status: 'pending',
    progress: 0,
    retryCount: 0,
    bytesUploaded: 0,
    bytesTotal: 1,
    ...overrides,
  };
}

const setRowCategories = jest.fn(() => 0);
const setBatchCategory = jest.fn();
const reorderQueue = jest.fn();

function Harness({ files }: { files: UploadQueueItem[] }) {
  const seed = useSetValuesSeed();
  const s = useBatchSetValues({
    seed,
    files,
    channelId: 'ch',
    playlists: null,
    batchPlaylists: { setBatchPlaylists: jest.fn(), overrides: {}, setRowPlaylists: jest.fn(), committed: {} },
    setBatchCategory,
    setRowCategories,
    reorderQueue,
  });
  return (
    <div>
      {s.toolbar}
      {files.map((f) => (
        <div key={f.id} data-testid={`row-${f.id}`}>
          {s.renderSelect(f)}
          <span data-testid={`title-${f.id}`}>{s.titleOf(f)}</span>
          {s.renderTitles(f)}
        </div>
      ))}
      {s.panel}
    </div>
  );
}

describe('upload queue "Set values"', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLang = 'en';
    mockUpdate.mockReset().mockResolvedValue({ success: true });
    setRowCategories.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const files = [row('a', 'one.mp4'), row('b', 'two.mp4'), row('c', 'three.mp4')];

  async function setPattern(pattern: string, opts: { overwrite?: boolean; scope?: 'all' | 'selected' } = {}) {
    fireEvent.click(screen.getByTestId('batch-set-values'));
    if (opts.scope) fireEvent.click(screen.getByTestId(`batch-set-scope-${opts.scope}`));
    if (opts.overwrite) fireEvent.click(screen.getByTestId('batch-set-overwrite'));
    // The panel starts from the values last set for all files
    if (!(screen.getByTestId('bulk-set-tick-title') as HTMLInputElement).checked) fireEvent.click(screen.getByTestId('bulk-set-tick-title'));
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: pattern } });
    fireEvent.click(screen.getByTestId('batch-set-apply'));
  }

  it('is worded as setting values, and fills every row from a pattern', async () => {
    render(<Harness files={files} />);
    expect(screen.getByTestId('batch-set-values')).toHaveTextContent('Set values');
    expect(screen.getByTestId('title-a')).toHaveTextContent('one');

    await setPattern('Lesson {n}');
    expect(screen.getByTestId('title-a')).toHaveTextContent('Lesson 1');
    expect(screen.getByTestId('title-c')).toHaveTextContent('Lesson 3');
    expect(screen.getByTestId('batch-set-notice')).toHaveTextContent('Values set for 3 files.');

    // Each row's video gets its own values (no bulk call)
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(3));
    expect(mockUpdate).toHaveBeenCalledWith('vid-a', { titleLocalized: { en: 'Lesson 1', ar: '' }, title: 'Lesson 1' }, { channelId: 'ch' });
  });

  it('keeps a title typed on a row, unless "overwrite my changes" is ticked', async () => {
    render(<Harness files={files} />);
    fireEvent.change(screen.getAllByTestId('batch-file-title-en')[1], { target: { value: 'My title' } });
    expect(screen.getByTestId('batch-file-title-edited')).toBeInTheDocument();

    await setPattern('Part {n}');
    expect(screen.getByTestId('title-b')).toHaveTextContent('My title');
    expect(screen.getByTestId('title-a')).toHaveTextContent('Part 1');
    expect(screen.getByTestId('batch-set-notice')).toHaveTextContent('1 values you changed by hand were kept.');

    await setPattern('Part {n}', { overwrite: true });
    expect(screen.getByTestId('title-b')).toHaveTextContent('Part 2');
  });

  it('sets values for the ticked files only', async () => {
    render(<Harness files={files} />);
    fireEvent.click(screen.getAllByTestId('batch-file-select')[2]);
    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent('1 selected');
    await setPattern('Only {n}', { scope: 'selected' });
    expect(screen.getByTestId('title-a')).toHaveTextContent('one');
    expect(screen.getByTestId('title-c')).toHaveTextContent('Only 1');
  });

  it('gives Arabic title fields their own direction', () => {
    mockLang = 'ar';
    render(<Harness files={files} />);
    expect(screen.getAllByTestId('batch-file-title-ar')[0]).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByTestId('batch-file-title-en')[0]).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('batch-set-values')).toHaveTextContent('تعيين القيم');
  });

  it('numbers the files in the order chosen by file name (natural) and uploads in that order', async () => {
    const named = [row('a', 'part 10.mp4'), row('b', 'part 2.mp4'), row('c', 'part 1.mp4')];
    render(<Harness files={named} />);
    fireEvent.click(screen.getByTestId('batch-set-values'));
    fireEvent.click(screen.getByTestId('bulk-set-tick-title'));
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
    // Files have no upload date, publish date or duration yet
    expect(Array.from((screen.getByTestId('bulk-set-preview-order-key') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['list', 'title', 'filename']);
    fireEvent.change(screen.getByTestId('bulk-set-preview-order-key'), { target: { value: 'filename' } });
    expect(screen.getAllByTestId('bulk-set-preview-row').map((r) => r.getAttribute('data-id'))).toEqual(['c', 'b', 'a']);
    fireEvent.keyDown(screen.getAllByTestId('bulk-set-preview-handle')[2], { key: 'ArrowUp', altKey: true });
    expect(screen.getByTestId('bulk-set-preview-moved')).toHaveTextContent('Moved to position 2 of 3');
    fireEvent.click(screen.getByTestId('batch-set-apply'));
    expect(screen.getByTestId('title-c')).toHaveTextContent('Lesson 1');
    expect(screen.getByTestId('title-a')).toHaveTextContent('Lesson 2');
    expect(screen.getByTestId('title-b')).toHaveTextContent('Lesson 3');
    expect(reorderQueue).toHaveBeenCalledWith(['c', 'a', 'b']);
  });

  it('the direction button reverses the order and the numbers follow it', () => {
    const named = [row('a', 'part 10.mp4'), row('b', 'part 2.mp4'), row('c', 'part 1.mp4')];
    render(<Harness files={named} />);
    fireEvent.click(screen.getByTestId('batch-set-values'));
    fireEvent.click(screen.getByTestId('bulk-set-tick-title'));
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
    const ids = () => screen.getAllByTestId('bulk-set-preview-row').map((r) => r.getAttribute('data-id'));
    fireEvent.change(screen.getByTestId('bulk-set-preview-order-key'), { target: { value: 'filename' } });
    fireEvent.click(screen.getByTestId('bulk-set-preview-order-dir'));
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(screen.getByTestId('bulk-set-preview-order-dir')).toHaveAttribute('aria-label', 'Descending');
    fireEvent.click(screen.getByTestId('bulk-set-preview-order-dir'));
    expect(ids()).toEqual(['c', 'b', 'a']);
    fireEvent.change(screen.getByTestId('bulk-set-preview-order-key'), { target: { value: 'list' } });
    fireEvent.click(screen.getByTestId('bulk-set-preview-order-dir'));
    expect(ids()).toEqual(['c', 'b', 'a']);
    expect(screen.getAllByTestId('bulk-set-preview-after').map((el) => el.textContent)).toEqual(['Lesson 1', 'Lesson 2', 'Lesson 3']);
  });

  it('sets the English and Arabic titles of every file in one pass, to different values', async () => {
    render(<Harness files={files} />);
    fireEvent.click(screen.getByTestId('batch-set-values'));
    fireEvent.click(screen.getByTestId('bulk-set-tick-title'));
    fireEvent.click(screen.getByTestId('rename-lang-ar'));
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Lesson {n}' } });
    fireEvent.change(screen.getByTestId('rename-pattern-ar'), { target: { value: 'الدرس {n}' } });
    fireEvent.click(screen.getByTestId('batch-set-apply'));
    expect((screen.getAllByTestId('batch-file-title-en') as HTMLInputElement[]).map((i) => i.value)).toEqual(['Lesson 1', 'Lesson 2', 'Lesson 3']);
    expect((screen.getAllByTestId('batch-file-title-ar') as HTMLInputElement[]).map((i) => i.value)).toEqual(['الدرس 1', 'الدرس 2', 'الدرس 3']);
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('vid-a', { titleLocalized: { en: 'Lesson 1', ar: 'الدرس 1' }, title: 'Lesson 1' }, { channelId: 'ch' }));
  });

  it('gives each row its own English and Arabic description', () => {
    render(<Harness files={files} />);
    const ar = screen.getAllByTestId('batch-file-description-ar')[0];
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(ar).toHaveAttribute('lang', 'ar');
    fireEvent.change(ar, { target: { value: 'وصف' } });
    expect(screen.getAllByTestId('batch-file-description-en')[0]).toHaveValue('');
    expect(ar).toHaveValue('وصف');
  });

  it('skips the Arabic title of files that have none when the pattern uses {title}', () => {
    render(<Harness files={files} />);
    fireEvent.change(screen.getAllByTestId('batch-file-title-ar')[1], { target: { value: 'درس' } });
    fireEvent.click(screen.getByTestId('batch-set-values'));
    fireEvent.click(screen.getByTestId('bulk-set-tick-title'));
    fireEvent.click(screen.getByTestId('rename-lang-ar'));
    fireEvent.change(screen.getByTestId('rename-pattern-en'), { target: { value: 'Series {n}: {title}' } });
    fireEvent.change(screen.getByTestId('rename-pattern-ar'), { target: { value: 'سلسلة {n}: {title}' } });
    const skipped = screen.getAllByTestId('bulk-set-preview-cell').filter((c) => c.getAttribute('data-skipped') === 'no_title');
    expect(skipped.map((c) => c.getAttribute('data-language'))).toEqual(['ar', 'ar']);
    expect(skipped[0]).toHaveTextContent('Skipped: no Arabic title');
    expect(screen.getByTestId('bulk-set-preview-summary')).toHaveAttribute('data-skipped', '2');
    fireEvent.click(screen.getByTestId('batch-set-apply'));
    // Files without an Arabic title keep it empty; the one typed by hand is the creator's own (kept, no overwrite)
    expect((screen.getAllByTestId('batch-file-title-ar') as HTMLInputElement[]).map((i) => i.value)).toEqual(['', 'درس', '']);
    expect((screen.getAllByTestId('batch-file-title-en') as HTMLInputElement[]).map((i) => i.value)).toEqual(['Series 1: one', 'Series 2: two', 'Series 3: three']);
  });

  describe('while the creator Terms are not accepted (#1929)', () => {
    const refused = { success: false, code: 'terms_required' };
    const wait = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });
    const state = () => screen.getByTestId('batch-file-values-save');
    beforeEach(() => {
      mockTermsAccepted = true;
      mockMark.mockReset();
      mockSchedule.mockReset();
    });

    it('a row says why it is not saved, is not retried blindly, and is saved once they are accepted', async () => {
      mockUpdate.mockResolvedValue(refused);
      const { rerender } = render(<Harness files={[files[0]]} />);
      fireEvent.change(screen.getByTestId('batch-file-title-en'), { target: { value: 'Mine' } });
      await wait(800);
      expect(state()).toHaveAttribute('data-state', 'terms');
      expect(state()).toHaveTextContent(jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS.creator.termsRequired);
      expect(mockMark).toHaveBeenCalledTimes(1);
      await wait(60_000);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      mockUpdate.mockResolvedValue({ success: true });
      mockTermsAccepted = true;
      rerender(<Harness files={[files[0]]} />);
      await wait(50);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]);
      expect(state()).toHaveAttribute('data-state', 'saved');
    });

    it('a server that keeps refusing after they are accepted is asked a bounded number of times', async () => {
      mockUpdate.mockResolvedValue(refused);
      const { rerender } = render(<Harness files={[files[0]]} />);
      fireEvent.change(screen.getByTestId('batch-file-title-en'), { target: { value: 'Mine' } });
      await wait(800);
      for (let i = 0; i < 10; i++) {
        mockTermsAccepted = false;
        rerender(<Harness files={[files[0]]} />);
        mockTermsAccepted = true;
        rerender(<Harness files={[files[0]]} />);
        await wait(50);
      }
      expect(mockUpdate).toHaveBeenCalledTimes(4);
    });

    it('a publish time that was refused is set once they are accepted', async () => {
      mockSchedule.mockResolvedValueOnce({ success: false, status: 403, code: 'terms_required' }).mockResolvedValue({ success: true });
      const done = [row('a', 'one.mp4', { status: 'completed' })];
      const { rerender } = render(<Harness files={done} />);
      fireEvent.click(screen.getByTestId('batch-set-values'));
      fireEvent.click(screen.getByTestId('bulk-set-tick-schedule'));
      fireEvent.change(screen.getByTestId('bulk-set-schedule-start'), { target: { value: '2099-01-01T10:00' } });
      fireEvent.click(screen.getByTestId('batch-set-apply'));
      await wait(2_000);
      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(state()).toHaveAttribute('data-state', 'terms');
      rerender(<Harness files={[...done]} />);
      await wait(2_000);
      expect(mockSchedule).toHaveBeenCalledTimes(1);
      mockTermsAccepted = true;
      rerender(<Harness files={[...done]} />);
      await wait(2_000);
      expect(mockSchedule).toHaveBeenCalledTimes(2);
      expect(mockSchedule.mock.calls[1]).toEqual(mockSchedule.mock.calls[0]);
      expect(state()).toHaveAttribute('data-state', 'saved');
    });
  });
});
