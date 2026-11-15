import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaylistCard } from '@/components/PlaylistCard';
import { PlaylistCover } from '../index';
import type { Playlist } from '@al-ummah/shared-types';

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img {...props} />,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ lang: mockLang, isRTL: mockLang === 'ar', t: { playlist: {} } }),
}));

const COVER = 'https://images.test/cover.jpg';

describe('PlaylistCover', () => {
  it('renders the derived cover', () => {
    render(<PlaylistCover playlist={{ cover: { thumbnailUrl: COVER } }} alt="Great" />);
    expect(screen.getByAltText('Great')).toHaveAttribute('src', COVER);
  });

  it('shows the designed placeholder for an empty playlist', () => {
    render(<PlaylistCover playlist={{}} alt="Empty" />);
    expect(screen.getByTestId('playlist-cover-placeholder')).toBeInTheDocument();
  });

  it('falls back to the placeholder when the image fails', () => {
    render(<PlaylistCover playlist={{ thumbnailUrl: COVER }} alt="Broken" />);
    fireEvent.error(screen.getByAltText('Broken'));
    expect(screen.getByTestId('playlist-cover-placeholder')).toBeInTheDocument();
  });
});

describe('PlaylistCard', () => {
  it('shows the API-derived cover when there is no custom thumbnail', () => {
    const playlist = { id: 'p', name: 'Great Mosques', dateCreated: '2026-11-09T00:00:00Z', cover: { videoId: 'v', thumbnailUrl: COVER } } as Playlist;
    render(<PlaylistCard {...playlist} />);
    expect(screen.getByAltText('Great Mosques')).toHaveAttribute('src', COVER);
  });

  describe('video count badge', () => {
    afterEach(() => { mockLang = 'en'; });
    const card = (videosCount: number) => render(<PlaylistCard {...({ id: 'p', name: 'List', dateCreated: '2026-11-09T00:00:00Z', videosCount } as Playlist)} />);

    it('says "1 video", never "1 videos"', () => {
      card(1);
      expect(screen.getByText('1 video')).toBeInTheDocument();
      expect(screen.queryByText('1 videos')).toBeNull();
    });

    it('uses the plural from 2 on', () => {
      card(3);
      expect(screen.getByText('3 videos')).toBeInTheDocument();
    });

    it('uses the Arabic forms', () => {
      mockLang = 'ar';
      const { unmount } = card(1);
      expect(screen.getByText('مرئي واحد')).toBeInTheDocument();
      unmount();
      card(11);
      expect(screen.getByText('١١ مرئيًا')).toBeInTheDocument();
    });
  });
});
