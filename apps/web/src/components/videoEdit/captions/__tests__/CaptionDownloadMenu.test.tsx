import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CAPTIONS_AR, CAPTIONS_EN } from '@al-ummah/shared-types';

jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reporter = require('@/lib/errors/reporter') as { reportError: jest.Mock };

import CaptionDownloadMenu from '../CaptionDownloadMenu';

/** jsdom has no fetch Response: the parts downloadCaptionFile reads */
function fakeResponse(status: number, disposition?: string, blob: Blob = new Blob(['WEBVTT\n'])) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => (n.toLowerCase() === 'content-disposition' ? disposition ?? null : null) }, blob: async () => blob } as unknown as Response;
}

const ok = () => fakeResponse(200, 'attachment; filename="v1-ar-draft-v3.srt"');

function open() {
  const trigger = screen.getByTestId('caption-download');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('CaptionDownloadMenu', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a keyboard menu with both formats; picking SubRip downloads that file with the session', async () => {
    const fetchMock = jest.fn(async () => ok());
    const save = jest.fn();
    render(<CaptionDownloadMenu videoId="v1" language="ar" languageLabel="Arabic" source="draft" t={CAPTIONS_EN.download} deps={{ fetch: fetchMock as unknown as typeof fetch, save }} />);
    expect(screen.getByRole('button', { name: 'Download captions (Arabic)' })).toHaveTextContent('Download captions');
    open();
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['WebVTT (.vtt)', 'SubRip (.srt)']);
    expect(screen.getByTestId('caption-download-srt').querySelector('[dir="ltr"]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('caption-download-srt'), { key: 'Enter' });
    });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/studio-download/captions/v1/draft/ar.srt', { credentials: 'same-origin', cache: 'no-store' });
    expect(save.mock.calls[0][1]).toBe('v1-ar-draft-v3.srt');
    expect(screen.queryByTestId('caption-download-failed')).toBeNull();
  });

  it('says it failed (Arabic), reports server failures but not a refusal', async () => {
    const fetchMock = jest.fn(async () => fakeResponse(502));
    render(<CaptionDownloadMenu videoId="v1" language="ar" languageLabel="العربية" source="track" t={CAPTIONS_AR.download} deps={{ fetch: fetchMock as unknown as typeof fetch, save: jest.fn() }} />);
    expect(screen.getByRole('button', { name: 'تنزيل الترجمة (العربية)' })).toBeInTheDocument();
    open();
    await act(async () => {
      fireEvent.keyDown(await screen.findByTestId('caption-download-vtt'), { key: 'Enter' });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر تنزيل الترجمة. حاول مرة أخرى.');
    expect(reporter.reportError).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(fakeResponse(403));
    open();
    await act(async () => {
      fireEvent.keyDown(await screen.findByTestId('caption-download-vtt'), { key: 'Enter' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(reporter.reportError).toHaveBeenCalledTimes(1);
  });
});
