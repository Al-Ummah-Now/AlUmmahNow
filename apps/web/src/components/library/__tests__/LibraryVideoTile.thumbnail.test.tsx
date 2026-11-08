import React from 'react';
import { render } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    isRTL: false,
  }),
}));

const thumbnailProps = jest.fn();
jest.mock('@/components/VideoThumbnail', () => ({
  __esModule: true,
  ...(() => {
    const actual = jest.requireActual('@/components/VideoThumbnail');
    return { THUMBNAIL_16_9: actual.THUMBNAIL_16_9 };
  })(),
  default: (props: Record<string, unknown>) => {
    thumbnailProps(props);
    return null;
  },
}));

import { LibraryVideoTile } from '../LibraryVideoTile';

describe('LibraryVideoTile thumbnail box', () => {
  it('sizes the thumbnail inline: aspect-video produces no CSS with the aspect-ratio plugin', () => {
    render(<LibraryVideoTile video={{ id: 'a', title: 'Lecture', thumbnailUrl: 'https://cdn/a.jpg' }} />);
    const props = thumbnailProps.mock.calls[0][0] as { style?: { aspectRatio?: string }; className?: string };
    expect(props.style?.aspectRatio).toBe('16 / 9');
    expect(props.className ?? '').not.toContain('aspect-video');
  });
});
