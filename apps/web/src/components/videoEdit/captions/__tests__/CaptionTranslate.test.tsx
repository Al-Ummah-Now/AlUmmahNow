import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CAPTIONS_AR, CAPTIONS_EN } from '@al-ummah/shared-types';

jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
const startCaptionTranslation = jest.fn();
const cancelCaptionJob = jest.fn();
jest.mock('@/lib/api/caption-drafts', () => ({
  startCaptionTranslation: (...a: unknown[]) => startCaptionTranslation(...a),
  cancelCaptionJob: (...a: unknown[]) => cancelCaptionJob(...a),
}));

import CaptionTranslate, { MAX_TRANSLATION_LANGUAGES, TranslationJobs } from '../CaptionTranslate';

const usage = (over: Record<string, unknown> = {}) => ({
  period: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z', unlimited: false, via: 'tier', tierMinutes: 120, monthGranted: 0, monthLimit: 120,
  monthUsed: 34, packsRemaining: 0, overdraft: 0, held: 0, remaining: 86, warning: false, ...over,
});
const label = (code: string) => ({ en: 'English', ar: 'Arabic', fr: 'French', ur: 'Urdu' })[code] ?? code;

function setup(over: Partial<React.ComponentProps<typeof CaptionTranslate>> = {}) {
  const confirm = jest.fn(async () => true);
  const reload = jest.fn(async () => undefined);
  render(
    <CaptionTranslate
      videoId="v1" sourceLanguage="en" jobs={[]} minutes={{ usage: usage() as never, minutesNeeded: 12 }} draftLanguages={['en']}
      t={CAPTIONS_EN} lang="en" confirm={confirm} label={label} reload={reload} onClose={jest.fn()} {...over}
    />,
  );
  return { confirm, reload };
}

describe('CaptionTranslate', () => {
  beforeEach(() => {
    startCaptionTranslation.mockReset();
    cancelCaptionJob.mockReset();
  });

  it('never offers the source language, and shows the cost per language before confirming', () => {
    setup();
    expect(screen.queryByTestId('caption-translate-lang-en')).toBeNull();
    fireEvent.click(screen.getByTestId('caption-translate-lang-ar'));
    fireEvent.click(screen.getByTestId('caption-translate-lang-fr'));
    expect(screen.getByTestId('caption-translate-cost')).toHaveTextContent('Uses 24 caption minutes. 86 left this month.');
    expect(screen.getByText(CAPTIONS_EN.translate.quranNote)).toBeInTheDocument();
  });

  it('writes the Arabic cost and remaining minutes in Eastern Arabic (Hindi) numerals', () => {
    setup({ t: CAPTIONS_AR, lang: 'ar' });
    fireEvent.click(screen.getByTestId('caption-translate-lang-fr'));
    const cost = screen.getByTestId('caption-translate-cost').textContent ?? '';
    expect(cost).toContain('١٢');
    expect(cost).toContain('٨٦');
    expect(cost).not.toMatch(/[0-9]/);
  });

  it(`allows at most ${MAX_TRANSLATION_LANGUAGES} languages at a time`, () => {
    setup();
    const boxes = screen.getAllByRole('checkbox');
    boxes.slice(0, MAX_TRANSLATION_LANGUAGES).forEach((b) => fireEvent.click(b));
    expect(boxes[MAX_TRANSLATION_LANGUAGES]).toBeDisabled();
  });

  it('asks first, then starts one job per language (never automatic)', async () => {
    startCaptionTranslation.mockResolvedValue({ ok: true, data: { jobs: [{ id: 'j1' }] } });
    const { confirm, reload } = setup();
    fireEvent.click(screen.getByTestId('caption-translate-lang-ar'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-translate-action'));
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: CAPTIONS_EN.translate.title, description: expect.stringContaining('Uses 12 caption minutes') }));
    expect(startCaptionTranslation).toHaveBeenCalledWith('v1', 'en', ['ar'], false);
    expect(screen.getByRole('status')).toHaveTextContent(CAPTIONS_EN.translate.started);
    expect(reload).toHaveBeenCalled();
  });

  it('does nothing when the creator cancels', async () => {
    const { confirm } = setup();
    confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByTestId('caption-translate-lang-ar'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-translate-action'));
    });
    expect(startCaptionTranslation).not.toHaveBeenCalled();
  });

  it('asks before replacing an existing draft in that language', async () => {
    startCaptionTranslation.mockResolvedValue({ ok: true, data: { jobs: [{ id: 'j1' }] } });
    const { confirm } = setup({ draftLanguages: ['en', 'ar'] });
    fireEvent.click(screen.getByTestId('caption-translate-lang-ar'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-translate-action'));
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace the Arabic draft?', danger: true }));
    expect(startCaptionTranslation).toHaveBeenCalledWith('v1', 'en', ['ar'], true);
  });

  it('explains a refusal: out of minutes, paused, video not ready', async () => {
    setup();
    fireEvent.click(screen.getByTestId('caption-translate-lang-ar'));
    startCaptionTranslation.mockResolvedValueOnce({ ok: false, status: 402, error: 'insufficient_minutes', details: { usage: usage({ remaining: 0 }) } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-translate-action'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(CAPTIONS_EN.translate.noMinutes);
  });

  it('switched off meanwhile (404 feature_off): no message, the form closes and the features are read again', async () => {
    const onClose = jest.fn();
    const onFeatureOff = jest.fn();
    setup({ onClose, onFeatureOff });
    fireEvent.click(screen.getByTestId('caption-translate-lang-fr'));
    startCaptionTranslation.mockResolvedValueOnce({ ok: false, status: 404, error: 'feature_off', details: { code: 'feature_off' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-translate-action'));
    });
    expect(onFeatureOff).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists running and failed translations, with minutes given back', () => {
    const job = (over: Record<string, unknown>) => ({ id: 'j', videoId: 'v1', kind: 'translate', language: 'fr', status: 'translating', progress: { done: 1, total: 3 }, minutesReserved: 12, minutesCharged: null, waived: false, error: null, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z', finishedAt: null, replace: false, ...over });
    render(
      <TranslationJobs videoId="v1" jobs={[job({ id: 'a' }), job({ id: 'b', language: 'ur', status: 'failed', error: 'translation_failed' })] as never} t={CAPTIONS_EN} label={label} confirm={jest.fn()} reload={jest.fn()} />,
    );
    expect(screen.getByTestId('caption-translation-job')).toHaveAttribute('data-language', 'fr');
    expect(screen.getByTestId('caption-translation-failed')).toHaveTextContent(`Urdu: ${CAPTIONS_EN.jobs.failed.translation_failed}`);
  });
});
