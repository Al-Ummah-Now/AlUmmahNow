import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
let quranText = true;
jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ ready: true, features: { ...jest.requireActual('@al-ummah/shared-types').NO_FEATURES, quranText } }),
}));

const HEARD = 'قل هو الله احد';
const draft = {
  language: 'ar',
  version: 3,
  kind: 'source',
  origin: 'review_transcript',
  edited: false,
  cueCount: 2,
  pendingQuran: 2,
  updatedAt: 'x',
  track: 'none',
  cues: [
    { id: 'a', startMs: 0, endMs: 3000, segments: [{ type: 'speech', text: 'قال الشيخ' }] },
    { id: 'b', startMs: 3000, endMs: 6000, segments: [{ type: 'quran', range: '112:1:1-112:1:4', status: 'confirmed', heard: HEARD }] },
    { id: 'c', startMs: 6000, endMs: 8000, segments: [{ type: 'quran', range: '55:13:1-55:13:4', status: 'review', heard: 'فباي الاء ربكما تكذبان' }] },
  ],
};

const getCaptionDraft = jest.fn();
const saveCaptionDraft = jest.fn();
const publishCaptionDraft = jest.fn();
const getQuranPassage = jest.fn();
jest.mock('@/lib/api/caption-drafts', () => ({
  getCaptionDraft: (...a: unknown[]) => getCaptionDraft(...a),
  saveCaptionDraft: (...a: unknown[]) => saveCaptionDraft(...a),
  publishCaptionDraft: (...a: unknown[]) => publishCaptionDraft(...a),
  getQuranPassage: (...a: unknown[]) => getQuranPassage(...a),
}));

import CaptionDraftEditor from '../CaptionDraftEditor';

beforeEach(() => {
  jest.clearAllMocks();
  quranText = true;
  getCaptionDraft.mockResolvedValue({ ok: true, data: JSON.parse(JSON.stringify(draft)) });
  saveCaptionDraft.mockImplementation(async (_v: string, _l: string, base: number) => ({ ok: true, data: { ...draft, version: base + 1, cues: 3 } }));
  publishCaptionDraft.mockResolvedValue({ ok: true, data: { draft: { ...draft, version: 4, publishedVersion: 4, track: 'machine', cues: 3 } } });
  getQuranPassage.mockResolvedValue({
    ok: true,
    data: { range: '112:1:1-112:1:4', label: '112:1', surah: { number: 112, nameArabic: 'الإخلاص', nameSimple: 'Al-Ikhlas' }, ayat: [{ ayah: 1, text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ', partial: false }], quranComUrl: 'https://quran.com/112/1' },
  });
});

const renderEditor = () =>
  render(<CaptionDraftEditor videoId="v1" language="ar" languageLabel="Arabic" open onClose={jest.fn()} onChanged={jest.fn()} />);

/** The header buttons render (disabled) before the draft loads: wait for the loaded draft. */
const loaded = async () => {
  await waitFor(() => expect(screen.getByTestId('caption-publish')).toBeEnabled());
};

describe('CaptionDraftEditor', () => {
  it('shows Quran spans as references, never the heard text; a confirmed span shows the official text', async () => {
    renderEditor();
    const spans = await screen.findAllByTestId('caption-quran-span');
    expect(spans).toHaveLength(2);
    expect(document.body.textContent).not.toContain(HEARD);
    expect(document.body.textContent).not.toContain('فباي الاء');
    expect(getQuranPassage).not.toHaveBeenCalled(); // suggestions show no text
    fireEvent.click(within(spans[0]!).getByTestId('caption-quran-accept'));
    expect(await screen.findByText(/قُلْ هُوَ ٱللَّهُ أَحَدٌ/)).toBeTruthy();
    expect(screen.getByText('Quran data provided by Quran Foundation (https://quran.foundation/)')).toBeTruthy();
  });

  it('a translated draft names the Arabic text and the translation its viewers see', async () => {
    const translated = { ...draft, language: 'en', kind: 'translation', quranEdition: { name: 'Saheeh International' }, cues: [{ ...draft.cues[1]!, segments: [{ type: 'quran', range: '112:1:1-112:1:4', status: 'accepted' }] }] };
    getCaptionDraft.mockResolvedValue({ ok: true, data: translated });
    render(<CaptionDraftEditor videoId="v1" language="en" languageLabel="English" open onClose={jest.fn()} onChanged={jest.fn()} />);
    expect(await screen.findByText('Quran text: Uthmani (Hafs)')).toBeTruthy();
    expect(screen.getByText('Saheeh International').closest('p')!.textContent).toBe('Translation shown to viewers: Saheeh International');
  });

  it('the preview has its own controls (the page’s digits), not the browser’s', async () => {
    render(<CaptionDraftEditor videoId="v1" language="ar" languageLabel="Arabic" videoUrl="/clip.mp4" open onClose={jest.fn()} onChanged={jest.fn()} />);
    await loaded();
    const video = document.querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(false);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
    // Current time and duration each isolated left to right, so Arabic digits never swap them
    const clock = screen.getByRole('slider').previousElementSibling!;
    expect(Array.from(clock.querySelectorAll('span')).map((s) => s.getAttribute('dir'))).toEqual(['ltr', 'ltr']);
  });

  it('"Confirm all suggested" leaves possible Quran for a look; publish saves over the loaded version first', async () => {
    renderEditor();
    await loaded();
    const confirmAll = screen.getByTestId('caption-confirm-all');
    expect(confirmAll.textContent).toContain('(1)');
    fireEvent.click(confirmAll);
    const spans = screen.getAllByTestId('caption-quran-span');
    expect(spans.map((s) => s.getAttribute('data-status'))).toEqual(['accepted', 'review']);
    fireEvent.click(screen.getByTestId('caption-publish'));
    await waitFor(() => expect(publishCaptionDraft).toHaveBeenCalledWith('v1', 'ar', 4));
    expect(saveCaptionDraft).toHaveBeenCalledWith('v1', 'ar', 3, expect.any(Array));
    const saved = saveCaptionDraft.mock.calls[0]![3] as Array<{ segments: Array<{ status?: string }> }>;
    expect(saved[1].segments[0].status).toBe('accepted');
    expect(await screen.findByText('Published. Viewers now see these subtitles.')).toBeTruthy();
  });

  it('without our copy of the Quran text: reference and quran.com link only, no text, no note, no Different reference', async () => {
    quranText = false;
    renderEditor();
    const spans = await screen.findAllByTestId('caption-quran-span');
    expect(within(spans[0]!).queryByTestId('caption-quran-change')).toBeNull();
    fireEvent.click(within(spans[0]!).getByTestId('caption-quran-accept'));
    expect(screen.getAllByTestId('caption-quran-span')[0]!.getAttribute('data-status')).toBe('accepted');
    expect(within(screen.getAllByTestId('caption-quran-span')[0]!).getByRole('link')).toHaveAttribute('href', 'https://quran.com/112/1');
    expect(screen.queryByText('Quran data provided by Quran Foundation (https://quran.foundation/)')).toBeNull();
    expect(getQuranPassage).not.toHaveBeenCalled();
  });

  it('"Not Quran" turns a span back into editable speech', async () => {
    renderEditor();
    const spans = await screen.findAllByTestId('caption-quran-span');
    fireEvent.click(within(spans[1]!).getByTestId('caption-quran-reject'));
    expect(screen.getAllByTestId('caption-quran-span')).toHaveLength(1);
    expect(screen.getByDisplayValue('فباي الاء ربكما تكذبان')).toBeTruthy();
  });

  it('a save over a changed draft stops and offers Reload', async () => {
    saveCaptionDraft.mockResolvedValue({ ok: false, status: 409, error: 'draft_conflict', version: 9 });
    renderEditor();
    await loaded();
    fireEvent.click(screen.getByTestId('caption-confirm-all'));
    fireEvent.click(screen.getByTestId('caption-publish'));
    await waitFor(() => expect(screen.getByTestId('caption-save-state').getAttribute('data-state')).toBe('conflict'));
    expect(publishCaptionDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('asks before replacing an uploaded track', async () => {
    publishCaptionDraft.mockResolvedValueOnce({ ok: false, status: 409, error: 'replaces_upload' });
    renderEditor();
    await loaded();
    fireEvent.click(screen.getByTestId('caption-publish'));
    expect(await screen.findByText('Replace your uploaded subtitles?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(publishCaptionDraft).toHaveBeenLastCalledWith('v1', 'ar', 3, true));
  });
});
