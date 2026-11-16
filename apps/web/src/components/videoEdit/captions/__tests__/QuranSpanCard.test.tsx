/**
 * The official-text spinner always ends (owner review 2026-11-16: no endless spinners): on the
 * text, on feature_off, 404, a server error and a call that never completed (rejected / cancelled).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/version-skew', () => ({ recoverFromVersionSkew: () => false }));
const getQuranPassage = jest.fn();
jest.mock('@/lib/api/caption-drafts', () => ({ getQuranPassage: (...a: unknown[]) => getQuranPassage(...a) }));

import QuranSpanCard from '../QuranSpanCard';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

const t = EN_TRANSLATIONS.captions.quran;
let n = 0;
/** A fresh range per test: passages are cached per range for the page */
const segment = () => ({ kind: 'quran', status: 'accepted', range: `2:${++n}`, alternatives: [] }) as never;
const spinner = (container: HTMLElement) => container.querySelector('.animate-spin');
const renderCard = (textAvailable = true) =>
  render(<QuranSpanCard segment={segment()} t={t} lang="en" onAccept={jest.fn()} onReject={jest.fn()} onRange={jest.fn()} textAvailable={textAvailable} />);

beforeEach(() => getQuranPassage.mockReset());

describe('QuranSpanCard: the loading state ends', () => {
  it('in the official text', async () => {
    getQuranPassage.mockResolvedValue({ ok: true, data: { range: '2:1', ayat: [{ text: 'الم' }] } });
    const { container } = renderCard();
    expect(spinner(container)).not.toBeNull();
    expect(await screen.findByText(/الم/)).toBeInTheDocument();
    expect(spinner(container)).toBeNull();
  });

  it.each([
    ['feature_off', { ok: false, status: 404, error: 'feature_off' }],
    ['404', { ok: false, status: 404, error: 'not_found' }],
    ['a server error', { ok: false, status: 500, error: 'internal' }],
  ])('on %s, in the plain unavailable note', async (_name, result) => {
    getQuranPassage.mockResolvedValue(result);
    const { container } = renderCard();
    expect(await screen.findByText(t.textUnavailable)).toBeInTheDocument();
    expect(spinner(container)).toBeNull();
  });

  it('when the call never completes (rejected or cancelled), and the failure is not cached', async () => {
    getQuranPassage.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const first = renderCard();
    expect(await screen.findByText(t.textUnavailable)).toBeInTheDocument();
    expect(spinner(first.container)).toBeNull();
    getQuranPassage.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    const second = renderCard();
    await waitFor(() => expect(spinner(second.container)).toBeNull());
  });

  it('never starts while the official text is off (quranText)', () => {
    const { container } = renderCard(false);
    expect(spinner(container)).toBeNull();
    expect(getQuranPassage).not.toHaveBeenCalled();
  });
});
