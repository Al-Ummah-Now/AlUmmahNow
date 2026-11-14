import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
jest.mock('../CaptionDraftEditor', () => ({ __esModule: true, default: () => null }));

const listCaptionDrafts = jest.fn();
const listCaptionJobs = jest.fn();
const getCaptionMinutes = jest.fn();
const startCaptionJob = jest.fn();
const cancelCaptionJob = jest.fn();
jest.mock('@/lib/api/caption-drafts', () => ({
  listCaptionDrafts: (...a: unknown[]) => listCaptionDrafts(...a),
  listCaptionJobs: (...a: unknown[]) => listCaptionJobs(...a),
  getCaptionMinutes: (...a: unknown[]) => getCaptionMinutes(...a),
  startCaptionJob: (...a: unknown[]) => startCaptionJob(...a),
  cancelCaptionJob: (...a: unknown[]) => cancelCaptionJob(...a),
  claimReviewTranscript: jest.fn(),
  deleteCaptionDraft: jest.fn(),
  publishCaptionDraft: jest.fn(),
}));

import { reportError } from '@/lib/errors/reporter';
import CaptionDraftsPanel from '../CaptionDraftsPanel';
import { jobStepText, visibleJobs } from '../CaptionTranscribe';
import { CAPTIONS_EN } from '@al-ummah/shared-types';

const usage = (over: Record<string, unknown> = {}) => ({
  period: '2026-11',
  resetsAt: '2026-12-01T00:00:00.000Z',
  unlimited: false,
  via: 'tier',
  tierMinutes: 120,
  monthGranted: 0,
  monthLimit: 120,
  monthUsed: 34,
  packsRemaining: 0,
  remaining: 86,
  warning: false,
  ...over,
});
const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  videoId: 'v1',
  language: 'ar',
  replace: false,
  status: 'transcribing',
  progress: { done: 3, total: 7 },
  minutesReserved: 17,
  minutesCharged: null,
  waived: false,
  error: null,
  createdAt: '2026-11-14T00:00:00Z',
  updatedAt: '2026-11-14T00:00:00Z',
  finishedAt: null,
  ...over,
});
const arDraft = { language: 'ar', version: 2, kind: 'source', origin: 'transcription', edited: false, cues: 4, pendingQuran: 0, updatedAt: '2026-11-13T00:00:00Z', track: 'none' };

const setup = ({ jobs = [] as unknown[], minutes = { usage: usage(), minutesNeeded: 17 } as unknown, drafts = [] as unknown[] } = {}) => {
  listCaptionDrafts.mockResolvedValue({ ok: true, data: { drafts, claims: [], transcriptAvailable: false } });
  listCaptionJobs.mockResolvedValue({ ok: true, data: { jobs } });
  getCaptionMinutes.mockResolvedValue(minutes ? { ok: true, data: minutes } : { ok: false, status: 403, error: 'forbidden' });
};

beforeEach(() => {
  jest.clearAllMocks();
  startCaptionJob.mockResolvedValue({ ok: true, data: { job: job({ status: 'queued', progress: null }), existing: false } });
});
afterEach(() => jest.useRealTimers());

describe('CaptionTranscribe helpers', () => {
  it('shows the newest job of each language while it runs or after it failed', () => {
    const list = [
      job({ id: 'a', language: 'ar', status: 'ready' }),
      job({ id: 'b', language: 'ar', status: 'failed' }),
      job({ id: 'c', language: 'en', status: 'failed', error: 'no_speech' }),
      job({ id: 'd', language: 'fr', status: 'cancelled' }),
    ];
    expect(visibleJobs(list as never).map((j) => j.id)).toEqual(['c']);
    expect(visibleJobs([job({ id: 'x', status: 'queued' })] as never).map((j) => j.id)).toEqual(['x']);
  });

  it('names each step, with the chunks while transcribing', () => {
    expect(jobStepText(CAPTIONS_EN.jobs, job() as never)).toBe('Transcribing 3/7');
    expect(jobStepText(CAPTIONS_EN.jobs, job({ progress: null }) as never)).toBe('Transcribing');
    expect(jobStepText(CAPTIONS_EN.jobs, job({ status: 'extracting' }) as never)).toBe('Preparing audio');
    expect(jobStepText(CAPTIONS_EN.jobs, job({ status: 'postprocessing' }) as never)).toBe('Checking Quran');
  });
});

describe('CaptionDraftsPanel: Transcribe', () => {
  it('stays hidden when the minutes cannot be read and there is nothing else', async () => {
    setup({ minutes: null });
    const { container } = render(<CaptionDraftsPanel videoId="v1" />);
    await waitFor(() => expect(getCaptionMinutes).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="caption-transcribe"]')).toBeNull();
  });

  it('shows the meter and the cost, picks the video language and starts after confirming', async () => {
    setup();
    render(<CaptionDraftsPanel videoId="v1" spokenLanguage="en" />);
    expect(await screen.findByTestId('caption-minutes')).toHaveTextContent('Caption minutes: 34 / 120 this month · resets Dec 1');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '34');
    expect(screen.getByTestId('caption-transcribe-cost')).toHaveTextContent('This uses 17 of your 86 remaining caption minutes.');
    expect(screen.getByLabelText('Language spoken in the video', { selector: 'select' })).toHaveValue('en');
    fireEvent.click(screen.getByTestId('caption-transcribe-action'));
    expect(await screen.findByText('Transcribe this video?')).toBeInTheDocument();
    expect(startCaptionJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    await waitFor(() => expect(startCaptionJob).toHaveBeenCalledWith('v1', 'en', false));
  });

  it('asks before replacing a draft in that language and starts with replace', async () => {
    setup({ drafts: [arDraft] });
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-transcribe-action'));
    expect(await screen.findByText('Replace your draft?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    await waitFor(() => expect(startCaptionJob).toHaveBeenCalledWith('v1', 'ar', true));
  });

  it('a 402 shows the minutes left and the contact path instead of the button', async () => {
    setup();
    startCaptionJob.mockResolvedValue({
      ok: false,
      status: 402,
      error: 'upgrade_required',
      details: { entitlement: 'captions.monthlyMinutes', minutesNeeded: 17, usage: usage({ monthUsed: 110, remaining: 10, warning: true }) },
    });
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-transcribe-action'));
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }));
    expect(await screen.findByTestId('caption-minutes-short')).toHaveTextContent('Transcribing this video takes 17 caption minutes and you have 10 left. Your minutes reset on Dec 1.');
    expect(screen.getByRole('link', { name: 'Ask our team for more minutes' })).toHaveAttribute('href', '/en/contact');
    expect(screen.queryByTestId('caption-transcribe-action')).toBeNull();
    expect(screen.getByTestId('caption-minutes-warning')).toBeInTheDocument();
  });

  it('a cost above what is left never offers Transcribe; no plan says so', async () => {
    setup({ minutes: { usage: usage({ remaining: 5 }), minutesNeeded: 17 } });
    const { unmount } = render(<CaptionDraftsPanel videoId="v1" />);
    expect(await screen.findByTestId('caption-minutes-short')).toHaveTextContent('you have 5 left');
    unmount();
    setup({ minutes: { usage: usage({ via: 'none', tierMinutes: 0, monthLimit: 0, monthUsed: 0, remaining: 0 }), minutesNeeded: 17 } });
    render(<CaptionDraftsPanel videoId="v1" />);
    expect(await screen.findByTestId('caption-minutes-short')).toHaveTextContent("Your plan doesn't include caption minutes.");
  });

  it('unlimited plans see no meter limit and the unlimited cost', async () => {
    setup({ minutes: { usage: usage({ unlimited: true, via: 'super_admin', monthLimit: null, remaining: null }), minutesNeeded: 17 } });
    render(<CaptionDraftsPanel videoId="v1" />);
    expect(await screen.findByTestId('caption-minutes')).toHaveTextContent('Caption minutes: no monthly limit');
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByTestId('caption-transcribe-cost')).toHaveTextContent('This uses 17 caption minutes. Your plan has no monthly limit.');
  });

  it('waits for the video length before offering Transcribe', async () => {
    setup({ minutes: { usage: usage(), minutesNeeded: null } });
    render(<CaptionDraftsPanel videoId="v1" />);
    expect(await screen.findByTestId('caption-transcribe-cost')).toHaveTextContent('once it has finished processing');
    expect(screen.getByTestId('caption-transcribe-action')).toBeDisabled();
  });

  it('shows the running step, explains waiting for capacity, and polls until the draft is ready', async () => {
    jest.useFakeTimers();
    setup({ jobs: [job({ status: 'waiting_budget', progress: null })] });
    render(<CaptionDraftsPanel videoId="v1" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('caption-job')).toHaveTextContent('Arabic: Waiting');
    expect(screen.getByText(/capacity is used up/)).toBeInTheDocument();
    expect(screen.getByTestId('caption-transcribe-action')).toBeDisabled();
    listCaptionJobs.mockResolvedValue({ ok: true, data: { jobs: [job({ status: 'ready', minutesCharged: 17 })] } });
    listCaptionDrafts.mockResolvedValue({ ok: true, data: { drafts: [arDraft], claims: [], transcriptAvailable: false } });
    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('caption-job-ready')).toHaveTextContent('The Arabic draft is ready to check.');
    expect(screen.queryByTestId('caption-job')).toBeNull();
  });

  it('cancels after confirming; a job writing its draft says it is almost done', async () => {
    setup({ jobs: [job()] });
    cancelCaptionJob.mockResolvedValueOnce({ ok: false, status: 409, error: 'job_finishing' });
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-job-cancel'));
    expect(await screen.findByRole('button', { name: 'Keep transcribing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transcription' }));
    await waitFor(() => expect(cancelCaptionJob).toHaveBeenCalledWith('v1', 'j1'));
    expect(await screen.findByText(/the draft is being written/)).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a failed job says why, that the minutes came back, and offers Try again', async () => {
    setup({ jobs: [job({ status: 'failed', error: 'no_speech', progress: null })] });
    render(<CaptionDraftsPanel videoId="v1" />);
    const failed = await screen.findByTestId('caption-job-failed');
    expect(failed).toHaveTextContent('Arabic: No speech was found in this video.');
    expect(failed).toHaveTextContent('Your 17 caption minutes were given back.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }));
    await waitFor(() => expect(startCaptionJob).toHaveBeenCalledWith('v1', 'ar', false));
  });

  it('a server failure is reported and shown in plain words', async () => {
    setup();
    startCaptionJob.mockResolvedValue({ ok: false, status: 500, error: 'internal' });
    render(<CaptionDraftsPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('caption-transcribe-action'));
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }));
    expect(await screen.findByText("Couldn't start the transcription. Try again.")).toBeInTheDocument();
    expect(reportError).toHaveBeenCalled();
  });
});
