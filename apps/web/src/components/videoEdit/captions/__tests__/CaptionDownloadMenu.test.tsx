import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CAPTIONS_AR, CAPTIONS_EN } from '@al-ummah/shared-types';

jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reporter = require('@/lib/errors/reporter') as { reportError: jest.Mock };

import { CaptionDownloadButton, CaptionDownloadFormats } from '../CaptionDownloadMenu';
import type { CaptionDownloadDeps, CaptionDownloadSource } from '../caption-download';

/** jsdom has no fetch Response: the parts downloadCaptionFile reads */
function fakeResponse(status: number, disposition?: string, blob: Blob = new Blob(['WEBVTT\n'])) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => (n.toLowerCase() === 'content-disposition' ? disposition ?? null : null) }, blob: async () => blob } as unknown as Response;
}

const ok = () => fakeResponse(200, 'attachment; filename="v1-ar-draft-v3.srt"');

/** The row and card as the panels use them: the button in the actions, the formats below the row */
function Row({ t, label, source, deps, look }: { t: typeof CAPTIONS_EN.download; label: string; source: CaptionDownloadSource; deps: CaptionDownloadDeps; look?: 'draft' | 'track' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <CaptionDownloadButton language="ar" languageLabel={label} source={source} expanded={open} onToggle={() => setOpen((o) => !o)} t={t} look={look} />
      <button type="button">Publish</button>
      {open && <CaptionDownloadFormats videoId="v1" language="ar" languageLabel={label} source={source} t={t} onClose={() => setOpen(false)} deps={deps} />}
    </div>
  );
}

describe('Download captions (Studio)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the formats below the row with focus on the first; SubRip downloads that file with the session, then it closes', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ok());
    const save = jest.fn();
    render(<Row t={CAPTIONS_EN.download} label="Arabic" source="draft" deps={{ fetch: fetchMock as unknown as typeof fetch, save }} />);
    const button = screen.getByRole('button', { name: 'Download captions (Arabic)' });
    expect(button).toHaveTextContent('Download captions');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('caption-download-formats')).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Download captions (Arabic)' });
    expect(button).toHaveAttribute('aria-controls', group.id);
    expect(group).toHaveTextContent('Choose a file format');
    expect(screen.getByTestId('caption-download-vtt')).toHaveFocus();
    expect([screen.getByTestId('caption-download-vtt'), screen.getByTestId('caption-download-srt')].map((b) => b.textContent)).toEqual(['WebVTT (.vtt)', 'SubRip (.srt)']);
    expect(screen.getByTestId('caption-download-srt').querySelector('[dir="ltr"]')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-download-srt'));
    });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/studio-download/captions/v1/draft/ar.srt', { credentials: 'same-origin', cache: 'no-store' });
    expect(save.mock.calls[0][1]).toBe('v1-ar-draft-v3.srt');
    expect(screen.queryByTestId('caption-download-formats')).toBeNull();
    act(() => jest.runOnlyPendingTimers());
    expect(button).toHaveFocus();
    jest.useRealTimers();
  });

  it('Esc closes the formats and gives focus back to the button', () => {
    jest.useFakeTimers();
    render(<Row t={CAPTIONS_EN.download} label="Arabic" source="track" look="track" deps={{ fetch: jest.fn() as unknown as typeof fetch, save: jest.fn() }} />);
    const button = screen.getByTestId('caption-download');
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByTestId('caption-download-vtt'), { key: 'Escape' });
    expect(screen.queryByTestId('caption-download-formats')).toBeNull();
    act(() => jest.runOnlyPendingTimers());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    jest.useRealTimers();
  });

  it('says it failed (Arabic) and stays open; reports server failures but not a refusal', async () => {
    const fetchMock = jest.fn(async () => fakeResponse(502));
    render(<Row t={CAPTIONS_AR.download} label="العربية" source="track" look="track" deps={{ fetch: fetchMock as unknown as typeof fetch, save: jest.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'تنزيل الترجمة (العربية)' }));
    expect(screen.getByTestId('caption-download-formats')).toHaveTextContent('اختر صيغة الملف');
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-download-vtt'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر تنزيل الترجمة. حاول مرة أخرى.');
    expect(screen.getByTestId('caption-download-formats')).toBeInTheDocument();
    expect(reporter.reportError).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(fakeResponse(403));
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-download-vtt'));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(reporter.reportError).toHaveBeenCalledTimes(1);
  });
});
