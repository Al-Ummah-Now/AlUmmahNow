import { emptyBulkForm, type BulkFormState } from '@/lib/bulk-edit/form';
import { fileResumeKey } from '@/lib/upload/resume-store';
import {
  applySetValues,
  defaultsForNewFiles,
  editRow,
  initialRow,
  initiateFields,
  reorderWithin,
  updateFor,
  type QueueRowRef,
  type RowState,
} from '../set-values';

const refs: QueueRowRef[] = [
  { id: 'r1', fileName: 'tafsir-01.mp4' },
  { id: 'r2', fileName: 'tafsir-02.mp4' },
  { id: 'r3', fileName: 'tafsir-03.mov' },
];
const rowsOf = (): Record<string, RowState> => Object.fromEntries(refs.map((r) => [r.id, initialRow(r.fileName)]));

function patternForm(pattern: string, extra: Partial<BulkFormState> = {}): BulkFormState {
  const form = emptyBulkForm('en');
  return { ...form, ...extra, ticked: ['title', ...(extra.ticked ?? [])], rename: { ...form.rename, pattern, pad: 2, languages: ['en', 'ar'] } };
}

describe('set values for queued files', () => {
  it('starts each row from its file name without the extension', () => {
    expect(initialRow('Lesson 1.final.mp4').values.titleEn).toBe('Lesson 1.final');
  });

  it('sets titles from a pattern for all files, both languages on their own', () => {
    const result = applySetValues(rowsOf(), refs, patternForm('Tafsir {n}'), { overwrite: false });
    expect(refs.map((r) => result.rows[r.id].values.titleEn)).toEqual(['Tafsir 01', 'Tafsir 02', 'Tafsir 03']);
    expect(refs.map((r) => result.rows[r.id].values.titleAr)).toEqual(['Tafsir 01', 'Tafsir 02', 'Tafsir 03']);
    expect(result.changed).toEqual(['r1', 'r2', 'r3']);
    // Setting is not typing: nothing is marked as the creator's own
    expect(result.rows.r1.touched).toEqual([]);
  });

  it('keeps a title typed on a row unless overwrite is chosen', () => {
    const rows = rowsOf();
    rows.r2 = editRow(rows.r2, 'titleEn', { titleEn: 'My own title' });
    const kept = applySetValues(rows, refs, patternForm('Part {n}'), { overwrite: false });
    expect(kept.rows.r2.values.titleEn).toBe('My own title');
    expect(kept.rows.r2.values.titleAr).toBe('Part 02');
    expect(kept.skipped).toBe(1);

    const overwritten = applySetValues(rows, refs, patternForm('Part {n}'), { overwrite: true });
    expect(overwritten.rows.r2.values.titleEn).toBe('Part 02');
    expect(overwritten.rows.r2.touched).toEqual([]);
  });

  it('sets only for the ticked rows, numbering them in queue order', () => {
    const result = applySetValues(rowsOf(), [refs[0], refs[2]], patternForm('Q{n}'), { overwrite: false });
    expect(result.rows.r1.values.titleEn).toBe('Q01');
    expect(result.rows.r2.values.titleEn).toBe('tafsir-02');
    expect(result.rows.r3.values.titleEn).toBe('Q02');
  });

  it('sets the other ticked fields; a publish time makes the video private', () => {
    const form: BulkFormState = {
      ...emptyBulkForm('en'),
      ticked: ['language', 'visibility', 'tags', 'comments', 'schedule', 'description'],
      language: 'ar',
      visibility: 'public',
      tags: 'Tafsir، Quran',
      comments: 'held',
      scheduleStart: '2030-01-01T10:00',
      scheduleEvery: 1,
      scheduleUnit: 'days',
      description: { en: { enabled: true, mode: 'append', text: 'Series' }, ar: { enabled: false, mode: 'append', text: '' } },
    };
    const { rows } = applySetValues(rowsOf(), refs, form, { overwrite: false });
    expect(rows.r1.values).toMatchObject({ language: 'ar', tags: ['Tafsir', 'Quran'], commentSettings: 'held', descriptionEn: 'Series', isPublic: false });
    const times = refs.map((r) => new Date(rows[r.id].values.publishAt!).getTime());
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(23 * 3_600_000);
  });

  it('gives files picked later the values set for all, numbering on from the queue', () => {
    const values = defaultsForNewFiles(patternForm('Lesson {n}'), [{ name: 'a.mp4' }, { name: 'b.mp4' }], 3);
    expect(values.map((v) => v.titleEn)).toEqual(['Lesson 04', 'Lesson 05']);
    expect(defaultsForNewFiles(null, [{ name: 'a.mp4' }], 0)[0].titleEn).toBe('a');
  });

  it('sends the values with the video it creates', () => {
    const fields = initiateFields({ ...initialRow('x.mp4').values, titleEn: 'One', titleAr: 'واحد', language: 'ar' }, 'x.mp4');
    expect(fields).toMatchObject({ title: 'One', titleLocalized: { en: 'One', ar: 'واحد' }, language: 'ar', fileName: 'x.mp4' });
  });

  it('saves only what changed since the last save', () => {
    const saved = initialRow('x.mp4').values;
    expect(updateFor(saved, saved)).toBeNull();
    expect(updateFor(saved, { ...saved, titleAr: 'عنوان' })).toEqual({ titleLocalized: { en: 'x', ar: 'عنوان' }, title: 'x' });
  });

  it('never changes the remembered-upload key: renaming keeps resume working', () => {
    const file = { name: 'tafsir-01.mp4', size: 1234, lastModified: 42 };
    const before = fileResumeKey(file, 'ch');
    applySetValues(rowsOf(), refs, patternForm('Renamed {n}'), { overwrite: true });
    expect(fileResumeKey(file, 'ch')).toBe(before);
  });

  it('orders the ticked rows within their own positions, leaving the rest in place', () => {
    expect(reorderWithin(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b']);
    expect(reorderWithin(['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });
});
