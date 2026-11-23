import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RelatedVideosSection from '../index';
import RelatedVideosSectionRTL from '../rtl/index';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '@al-ummah/shared-types';
import type { VideoInfo } from '@/interfaces';

let mockLang: 'en' | 'ar' = 'en';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));

jest.mock('@/components/relatedVideo', () => ({
  __esModule: true,
  default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} />,
}));

jest.mock('@/components/relatedVideo/rtl', () => ({
  __esModule: true,
  default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} />,
}));

const card = (id: string) => ({ id, title: id }) as VideoInfo;

describe('RelatedVideosSection (LTR and RTL)', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  const variants = [
    {
      name: 'LTR (English)',
      lang: 'en' as const,
      expectedHeading: 'Related videos',
      expectedError: 'We couldn’t load related videos right now.',
      expectedRetry: 'Try again',
      renderShelf: (props: { relatedVideos: VideoInfo[]; loading?: boolean; failed?: boolean; onRetry?: () => void }) => (
        <RelatedVideosSection keyPrefix="t_" {...props} />
      ),
    },
    {
      name: 'RTL (Arabic)',
      lang: 'ar' as const,
      expectedHeading: 'مرئيات ذات صلة',
      expectedError: 'تعذّر تحميل المرئيات ذات الصلة حاليًا.',
      expectedRetry: 'حاول مرة أخرى',
      renderShelf: (props: { relatedVideos: VideoInfo[]; loading?: boolean; failed?: boolean; onRetry?: () => void }) => (
        <RelatedVideosSectionRTL {...props} />
      ),
    },
  ];

  describe.each(variants)('$name', ({ lang, expectedHeading, expectedError, expectedRetry, renderShelf }) => {
    beforeEach(() => {
      mockLang = lang;
    });

    it('shows the sentence-case/localized heading and skeleton while loading', () => {
      render(renderShelf({ relatedVideos: [], loading: true }));
      const region = screen.getByRole('region', { name: expectedHeading });
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('heading', { level: 2, name: expectedHeading })).toBeInTheDocument();
      expect(screen.getByTestId('related-videos-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('related-videos-error')).toBeNull();
    });

    it('hides the shelf completely when loaded empty (no error, no hollow section)', () => {
      const { container } = render(renderShelf({ relatedVideos: [], loading: false, failed: false, onRetry: jest.fn() }));
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('heading')).toBeNull();
      expect(screen.queryByTestId('related-videos-error')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows the failure alert and a flat filled retry button when loading fails', () => {
      const onRetry = jest.fn();
      render(renderShelf({ relatedVideos: [], loading: false, failed: true, onRetry }));

      expect(screen.getByRole('heading', { level: 2, name: expectedHeading })).toBeInTheDocument();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('data-testid', 'related-videos-error');
      expect(alert).toHaveTextContent(expectedError);

      const retryButton = screen.getByRole('button', { name: expectedRetry });
      expect(retryButton).toHaveClass('aun-btn', 'aun-btn-filled');
      expect(retryButton.className).not.toContain('bg-blue-700');

      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the related video cards when loaded', () => {
      render(renderShelf({ relatedVideos: [card('v1'), card('v2')], loading: false, failed: false }));
      expect(screen.getByRole('region', { name: expectedHeading })).not.toHaveAttribute('aria-busy');
      expect(screen.getByTestId('related-videos-list')).toBeInTheDocument();
      expect(screen.getByTestId('card-v1')).toBeInTheDocument();
      expect(screen.getByTestId('card-v2')).toBeInTheDocument();
      expect(screen.queryByTestId('related-videos-error')).toBeNull();
    });
  });
});
