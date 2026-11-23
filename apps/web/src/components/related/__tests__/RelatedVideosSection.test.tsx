import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RelatedVideosSection from '@/components/related';
import RelatedVideosSectionRTL from '@/components/related/rtl';

let mockArabic = false;

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      video: {
        relatedVideos: mockArabic ? 'مرئيات ذات صلة' : 'Related videos',
        relatedEmpty: mockArabic ? 'تعذّر تحميل المرئيات ذات الصلة حاليًا.' : 'We couldn’t load related videos right now.',
        relatedEmptyRetry: mockArabic ? 'حاول مرة أخرى' : 'Try again',
      },
    },
  }),
}));
jest.mock('@/components/relatedVideo', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/relatedVideo/rtl', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));

const videos = [{ id: 'rec-1' } as never];

type SectionProps = {
  relatedVideos: never[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
};

function renderSection(rtl: boolean, props: SectionProps) {
  mockArabic = rtl;
  return rtl
    ? render(<RelatedVideosSectionRTL {...props} />)
    : render(<RelatedVideosSection {...props} keyPrefix="test" />);
}

describe.each([{ direction: 'LTR', rtl: false }, { direction: 'RTL', rtl: true }])('related videos section ($direction)', ({ rtl }) => {
  beforeEach(() => { mockArabic = false; });

  it('shows the localized heading and skeleton while loading', () => {
    const { container } = renderSection(rtl, { relatedVideos: [], loading: true });
    expect(screen.getByRole('heading', { name: rtl ? 'مرئيات ذات صلة' : 'Related videos' })).toBeInTheDocument();
    expect(screen.getByTestId('related-videos-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('related-videos-error')).not.toBeInTheDocument();
    if (rtl) expect(container.firstChild).toHaveAttribute('dir', 'rtl');
  });

  it('shows only the failure UI and a filled retry button when failed', () => {
    const onRetry = jest.fn();
    renderSection(rtl, { relatedVideos: [], failed: true, onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent(rtl ? 'تعذّر تحميل المرئيات ذات الصلة حاليًا.' : 'We couldn’t load related videos right now.');
    const retry = screen.getByRole('button', { name: rtl ? 'حاول مرة أخرى' : 'Try again' });
    expect(retry).toHaveClass('bg-[var(--aun-btn-filled-bg)]', 'text-[var(--aun-btn-filled-fg)]', 'focus-visible:ring-[var(--fanous-color-focus-ring)]');
    expect(retry).not.toHaveClass('bg-blue-700');
    expect(screen.queryByTestId('related-videos-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('related-videos-list')).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no shelf markup for a successful empty result', () => {
    const { container } = renderSection(rtl, { relatedVideos: [], onRetry: jest.fn() });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the loaded list with the localized heading', () => {
    renderSection(rtl, { relatedVideos: videos });
    expect(screen.getByRole('heading', { name: rtl ? 'مرئيات ذات صلة' : 'Related videos' })).toBeInTheDocument();
    expect(screen.getByTestId('related-videos-list')).toBeInTheDocument();
    expect(screen.getByTestId('card-rec-1')).toBeInTheDocument();
    expect(screen.queryByTestId('related-videos-error')).not.toBeInTheDocument();
  });
});
