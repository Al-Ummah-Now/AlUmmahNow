/**
 * #1552: the related shelf's states, in both layouts. A failed load keeps the
 * message and Try again; a successful empty answer hides the shelf entirely
 * (no hollow sections) — never as an error.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RelatedVideosSection from '../index';
import RelatedVideosSectionRTL from '../rtl/index';
import type { VideoInfo } from '@/interfaces';
import type { RelatedShelfStatus } from '@/hooks/useRelatedVideos';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { video: { relatedVideos: 'Related videos', relatedLoadFailed: 'We couldn’t load related videos right now.', relatedLoadFailedRetry: 'Try again' } }, lang: 'en', isRTL: false }),
}));
jest.mock('@/components/relatedVideo', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/relatedVideo/rtl', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));

const card = (id: string) => ({ id, title: id }) as unknown as VideoInfo;
const sections = {
  ltr: { Section: RelatedVideosSection, heading: 'Related videos' },
  rtl: { Section: RelatedVideosSectionRTL, heading: 'المرئيات ذات الصلة' },
} as const;

describe.each(['ltr', 'rtl'] as const)('related shelf (%s)', (layout) => {
  const { heading } = sections[layout];
  const props = (extra: Partial<{ relatedVideos: VideoInfo[]; status: RelatedShelfStatus; onRetry: () => void }> = {}) => ({
    relatedVideos: [] as VideoInfo[],
    status: 'loading' as RelatedShelfStatus,
    ...extra,
  });
  const renderSection = (extra?: Parameters<typeof props>[0], onRetry?: () => void) =>
    render(layout === 'ltr'
      ? <sections.ltr.Section {...props(extra)} keyPrefix="t_" onRetry={onRetry} />
      : <sections.rtl.Section {...props(extra)} onRetry={onRetry} />);

  it('shows the heading and skeleton while loading', () => {
    renderSection();
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getAllByTestId('related-videos-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
    expect(screen.queryByTestId('related-videos-list')).toBeNull();
  });

  it('renders the videos when loaded', () => {
    renderSection({ relatedVideos: [card('rec-1')], status: 'success' });
    expect(screen.getByTestId('related-videos-list')).toBeInTheDocument();
    expect(screen.getByTestId('card-rec-1')).toBeInTheDocument();
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
  });

  it('renders nothing at all for a successful empty answer', () => {
    const { container } = renderSection({ status: 'success' });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
    expect(screen.queryByTestId('related-videos-list')).toBeNull();
  });

  it('keeps the failure message and Try again on a failed load, and retry is wired', () => {
    const onRetry = jest.fn();
    renderSection({ status: 'error' }, onRetry);
    expect(screen.getByTestId('related-videos-failed')).toBeInTheDocument();
    expect(screen.getByText('We couldn’t load related videos right now.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('the Try again button uses the shared filled button tokens, not a raw blue', () => {
    renderSection({ status: 'error' }, () => undefined);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.className).toContain('bg-[var(--aun-btn-filled-bg)]');
    expect(button.className).not.toContain('bg-blue-700');
  });
});
