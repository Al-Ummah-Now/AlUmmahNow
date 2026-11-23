import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS as en, AR_TRANSLATIONS as ar } from '@al-ummah/shared-types';
import RelatedVideosSection from '../index';
import RelatedVideosSectionRTL from '../rtl';
import type { RelatedShelfStatus } from '@/hooks/useRelatedVideos';

let mockRTL = false;
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const { EN_TRANSLATIONS: enT, AR_TRANSLATIONS: arT } = jest.requireActual('@al-ummah/shared-types');
    return { t: mockRTL ? arT : enT, lang: mockRTL ? 'ar' : 'en', isRTL: mockRTL };
  },
}));
jest.mock('@/components/relatedVideo', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/relatedVideo/rtl', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));

const card = (id: string) => ({ id, title: id }) as never;

const layouts = [
  { name: 'LTR', rtl: false, t: en, Shelf: (p: { status: RelatedShelfStatus; videos?: never[]; onRetry?: () => void }) => <RelatedVideosSection relatedVideos={p.videos ?? []} keyPrefix="t_" status={p.status} onRetry={p.onRetry ?? jest.fn()} /> },
  { name: 'RTL', rtl: true, t: ar, Shelf: (p: { status: RelatedShelfStatus; videos?: never[]; onRetry?: () => void }) => <RelatedVideosSectionRTL relatedVideos={p.videos ?? []} status={p.status} onRetry={p.onRetry ?? jest.fn()} /> },
];

describe.each(layouts)('related shelf ($name)', ({ rtl, t, Shelf }) => {
  beforeEach(() => {
    mockRTL = rtl;
  });

  it('shows the skeleton under the heading while loading', () => {
    render(<Shelf status="loading" />);
    expect(screen.getByRole('heading', { level: 2, name: t.video.relatedVideos })).toBeInTheDocument();
    expect(screen.getByTestId('related-videos-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('related-videos')).toHaveAttribute('aria-busy', 'true');
  });

  it('lists the videos when loaded', () => {
    render(<Shelf status="loaded" videos={[card('r1'), card('r2')]} />);
    expect(screen.getByTestId('card-r1')).toBeInTheDocument();
    expect(screen.getByTestId('card-r2')).toBeInTheDocument();
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
  });

  it('renders nothing when the answer is empty: no heading, no error, no retry', () => {
    const { container } = render(<Shelf status="empty" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(t.video.relatedFailed)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing for a loaded but empty list', () => {
    const { container } = render(<Shelf status="loaded" videos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('on failure: the message as a polite status and a filled "Try again" that keeps focus in the shelf', () => {
    const onRetry = jest.fn();
    render(<Shelf status="failed" onRetry={onRetry} />);
    expect(screen.getByRole('status')).toHaveTextContent(t.video.relatedFailed);
    const retry = screen.getByRole('button', { name: t.video.relatedRetry });
    expect(retry).toHaveClass('aun-btn', 'aun-btn-filled');
    expect(retry.className).not.toMatch(/bg-blue/);

    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
  });
});

describe('related shelf copy', () => {
  it('uses sentence case and the agreed English and Arabic text', () => {
    expect(en.video.relatedVideos).toBe('Related videos');
    expect(en.video.relatedFailed).toBe('We couldn’t load related videos right now.');
    expect(en.video.relatedRetry).toBe('Try again');
    expect(ar.video.relatedVideos).toBe('مرئيات ذات صلة');
    expect(ar.video.relatedFailed).toBe('تعذّر تحميل المرئيات ذات الصلة حاليًا.');
    expect(ar.video.relatedRetry).toBe('حاول مرة أخرى');
  });
});
