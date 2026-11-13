/**
 * #1208: a vertical video's skeleton takes the player's portrait (9:16) frame from the first paint,
 * so the player replacing it moves nothing (the Shorts page shifted by ~0.17 CLS on phones).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { WatchDetailsSkeleton, skeletonPortrait } from '../WatchPageSkeleton';
import { startsPortrait } from '@/components/VideoPagePlayer/interface';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

describe('portrait skeleton frame', () => {
  it('should be portrait for a vertical video, by its encoded size', () => {
    render(<WatchDetailsSkeleton hint={{ title: 'A Short', poster: '/thumb/s1.jpg', width: 1080, height: 1920 }} />);
    expect(screen.getByTestId('watch-skeleton-player')).toHaveAttribute('data-portrait', 'true');
  });

  it('should stay 16:9 for a landscape or square video, even on the Shorts page', () => {
    render(<WatchDetailsSkeleton hint={{ title: 'A lecture', width: 1920, height: 1080 }} />);
    render(<WatchDetailsSkeleton hint={{ title: 'A square Short', width: 1080, height: 1080 }} short />);
    for (const player of screen.getAllByTestId('watch-skeleton-player')) expect(player).not.toHaveAttribute('data-portrait');
  });

  it('should be portrait on the Shorts page when the size is unknown, 16:9 elsewhere', () => {
    expect(skeletonPortrait(undefined, true)).toBe(true);
    expect(skeletonPortrait({ title: 'A Short' }, true)).toBe(true);
    expect(skeletonPortrait({ title: 'A video' })).toBe(false);
  });

  it('should start the player in the frame the skeleton drew', () => {
    const cases = [
      { width: 1080, height: 1920, isShort: true },
      { width: 1920, height: 1080, isShort: false },
      { width: 1080, height: 1080, isShort: true },
      { isShort: true },
      { isShort: false },
    ];
    for (const c of cases) {
      expect(startsPortrait(c)).toBe(skeletonPortrait({ width: c.width, height: c.height }, c.isShort));
    }
  });
});
