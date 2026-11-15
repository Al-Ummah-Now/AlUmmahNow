import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getTranslatedMetadata = jest.fn();
jest.mock('@/lib/api/translate', () => ({ getTranslatedMetadata: (...a: unknown[]) => getTranslatedMetadata(...a) }));

import { useViewerTranslation, wantsViewerTranslation } from '../useViewerTranslation';

function Title({ video, lang }: { video: { id: string; title: string; titleLocalized?: Record<string, string> }; lang: string }) {
  const v = useViewerTranslation(video, lang);
  return (
    <div>
      <h1 data-testid="title">{v.showing ? v.translation!.title : video.title}</h1>
      {v.translation && <button onClick={v.toggle}>{v.showing ? 'Show original' : 'Show translation'}</button>}
    </div>
  );
}

describe('useViewerTranslation', () => {
  beforeEach(() => getTranslatedMetadata.mockReset());

  it('asks only when the title is in another language and the creator wrote none in it', () => {
    expect(wantsViewerTranslation({ title: 'Tafsir of Surah Al-Ikhlas' }, 'en')).toBe(false);
    expect(wantsViewerTranslation({ title: 'Tafsir of Surah Al-Ikhlas' }, 'ar')).toBe(true);
    expect(wantsViewerTranslation({ title: 'Tafsir', titleLocalized: { ar: 'تفسير' } }, 'ar')).toBe(false);
    expect(wantsViewerTranslation({ title: 'تفسير سورة الإخلاص' }, 'ar')).toBe(false);
    expect(wantsViewerTranslation({ title: '' }, 'ar')).toBe(false);
  });

  it('makes no request for a viewer of the title language', () => {
    render(<Title video={{ id: 'v-en', title: 'Tafsir' }} lang="en" />);
    expect(getTranslatedMetadata).not.toHaveBeenCalled();
  });

  it('shows the translation, with Show original, and asks once per video and language', async () => {
    getTranslatedMetadata.mockResolvedValue({ ok: true, data: { translation: { lang: 'ar', from: 'en', title: 'تفسير', description: null, provider: 'workers-ai' }, pending: false } });
    const video = { id: 'v1', title: 'Tafsir' };
    render(
      <>
        <Title video={video} lang="ar" />
        <Title video={video} lang="ar" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('title')[0]).toHaveTextContent('تفسير'));
    expect(getTranslatedMetadata).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Show original' })[0]!);
    });
    // One choice for the whole page (title and description)
    expect(screen.getAllByTestId('title').map((e) => e.textContent)).toEqual(['Tafsir', 'Tafsir']);
  });

  it('shows the original when the feature is off', async () => {
    getTranslatedMetadata.mockResolvedValue({ ok: true, data: { translation: null, pending: false } });
    render(<Title video={{ id: 'v2', title: 'Tafsir' }} lang="ar" />);
    await waitFor(() => expect(getTranslatedMetadata).toHaveBeenCalled());
    expect(screen.getByTestId('title')).toHaveTextContent('Tafsir');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
