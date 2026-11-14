import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
jest.mock('../CaptionDraftEditor', () => ({ __esModule: true, default: () => null }));

const listCaptionDrafts = jest.fn();
const claimReviewTranscript = jest.fn();
jest.mock('@/lib/api/caption-drafts', () => ({
  listCaptionDrafts: (...a: unknown[]) => listCaptionDrafts(...a),
  claimReviewTranscript: (...a: unknown[]) => claimReviewTranscript(...a),
  deleteCaptionDraft: jest.fn(),
  publishCaptionDraft: jest.fn(),
  listCaptionJobs: jest.fn(async () => ({ ok: true, data: { jobs: [] } })),
  getCaptionMinutes: jest.fn(async () => ({ ok: false, status: 403, error: 'forbidden' })),
}));

import CaptionDraftsPanel from '../CaptionDraftsPanel';

const arDraft = { language: 'ar', version: 2, kind: 'source', origin: 'upload', edited: true, cues: 4, pendingQuran: 0, updatedAt: '2026-11-13T00:00:00Z', track: 'none' };
const listed = (over: Record<string, unknown>) => ({ ok: true, data: { drafts: [], claims: [], transcriptAvailable: false, ...over } });

beforeEach(() => {
  jest.clearAllMocks();
  claimReviewTranscript.mockResolvedValue({ ok: true, data: { status: 'queued' } });
});
afterEach(() => jest.useRealTimers());

describe('CaptionDraftsPanel: using the review transcript (#1296)', () => {
  it('renders nothing with no drafts and no transcript', async () => {
    listCaptionDrafts.mockResolvedValue(listed({}));
    const { container } = render(<CaptionDraftsPanel videoId="v1" />);
    await waitFor(() => expect(listCaptionDrafts).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="caption-drafts"]')).toBeNull();
  });

  it('offers the transcript and queues a claim in the chosen language', async () => {
    listCaptionDrafts.mockResolvedValueOnce(listed({ transcriptAvailable: true }));
    listCaptionDrafts.mockResolvedValue(listed({ transcriptAvailable: true, claims: [{ language: 'en', status: 'queued', requestedAt: 'x' }] }));
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.change(await screen.findByLabelText('Language spoken in the video'), { target: { value: 'en' } });
    fireEvent.click(screen.getByTestId('caption-claim-action'));
    await waitFor(() => expect(claimReviewTranscript).toHaveBeenCalledWith('v1', 'en', false));
    expect(await screen.findByTestId('caption-claim-preparing')).toHaveTextContent('Preparing the English draft');
  });

  it('asks before replacing a draft in that language, then claims with replace', async () => {
    listCaptionDrafts.mockResolvedValue(listed({ transcriptAvailable: true, drafts: [arDraft] }));
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-claim-action'));
    expect(await screen.findByText('Replace your draft?')).toBeInTheDocument();
    expect(claimReviewTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(claimReviewTranscript).toHaveBeenCalledWith('v1', 'ar', true));
  });

  it('checks back while a draft is being prepared', async () => {
    jest.useFakeTimers();
    listCaptionDrafts.mockResolvedValue(listed({ transcriptAvailable: true, claims: [{ language: 'ar', status: 'queued', requestedAt: 'x' }] }));
    render(<CaptionDraftsPanel videoId="v1" />);
    await act(async () => {
      await Promise.resolve();
    });
    const before = listCaptionDrafts.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
    });
    expect(listCaptionDrafts.mock.calls.length).toBeGreaterThan(before);
  });

  it('a failed claim says why and offers Try again; a gone transcript hides the offer', async () => {
    listCaptionDrafts.mockResolvedValue(listed({ transcriptAvailable: true, claims: [{ language: 'ar', status: 'failed', requestedAt: 'x', error: 'failed' }] }));
    render(<CaptionDraftsPanel videoId="v1" />);
    expect(await screen.findByTestId('caption-claim-failed')).toHaveTextContent("Couldn't prepare the draft");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(claimReviewTranscript).toHaveBeenCalledWith('v1', 'ar', false));
  });

  it('a transcript purged meanwhile: the request says so and the offer goes', async () => {
    listCaptionDrafts.mockResolvedValue(listed({ transcriptAvailable: true }));
    claimReviewTranscript.mockResolvedValue({ ok: false, status: 404, error: 'transcript_not_found' });
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-claim-action'));
    expect(await screen.findByText('The automatic transcript is no longer available.')).toBeInTheDocument();
    expect(screen.queryByTestId('caption-claim-action')).toBeNull();
  });
});
