import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RelatedVideosSection from '../index';
import RelatedVideosSectionRTL from '../rtl/index';

let mockLang: 'en' | 'ar' = 'en';
const mockCopy = {
  en: { relatedVideos: 'Related videos', relatedError: "We couldn't load related videos right now.", relatedErrorRetry: 'Try again' },
  ar: { relatedVideos: 'مرئيات ذات صلة', relatedError: 'تعذّر تحميل المرئيات ذات الصلة حاليًا.', relatedErrorRetry: 'حاول مرة أخرى' },
};

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { video: mockCopy[mockLang] }, lang: mockLang, isRTL: mockLang === 'ar' }),
}));
jest.mock('@/components/relatedVideo', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/relatedVideo/rtl', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));

const card = (id: string) => ({ id, title: id }) as never;

describe('RelatedVideosSection', () => {
  beforeEach(() => { mockLang = 'en'; });

  it('shows the heading and skeleton while loading', () => {
    render(<RelatedVideosSection relatedVideos={[]} keyPrefix="t_" status="loading" />);
    expect(screen.getByRole('heading', { name: 'Related videos' })).toBeInTheDocument();
    expect(screen.getByTestId('related-videos-skeleton')).toBeInTheDocument();
  });

  it('shows the error and a retry button in the shared filled style when the request failed', () => {
    const onRetry = jest.fn();
    render(<RelatedVideosSection relatedVideos={[]} keyPrefix="t_" status="error" onRetry={onRetry} />);

    const error = screen.getByTestId('related-videos-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.getByText("We couldn't load related videos right now.")).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.className).toContain('--aun-btn-filled-bg');
    expect(retry.className).toContain('--aun-btn-filled-fg');
    expect(retry.className).not.toContain('bg-blue-700');

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at all when the request succeeded with no videos', () => {
    const { container } = render(<RelatedVideosSection relatedVideos={[]} keyPrefix="t_" status="ready" />);
    expect(container.firstChild).toBeNull();
  });

  it('lists the videos once loaded', () => {
    render(<RelatedVideosSection relatedVideos={[card('v1'), card('v2')]} keyPrefix="t_" status="ready" />);
    expect(screen.getByTestId('related-videos-list')).toBeInTheDocument();
    expect(screen.getByTestId('card-v1')).toBeInTheDocument();
    expect(screen.getByTestId('card-v2')).toBeInTheDocument();
  });
});

describe('RelatedVideosSectionRTL', () => {
  beforeEach(() => { mockLang = 'ar'; });

  it('shows the Arabic error and retry when the request failed', () => {
    render(<RelatedVideosSectionRTL relatedVideos={[]} status="error" onRetry={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'مرئيات ذات صلة' })).toBeInTheDocument();
    expect(screen.getByText('تعذّر تحميل المرئيات ذات الصلة حاليًا.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حاول مرة أخرى' })).toBeInTheDocument();
    expect(screen.getByTestId('related-videos-error').closest('[dir="rtl"]')).not.toBeNull();
  });

  it('renders nothing at all when the request succeeded with no videos', () => {
    const { container } = render(<RelatedVideosSectionRTL relatedVideos={[]} status="ready" />);
    expect(container.firstChild).toBeNull();
  });
});
