/**
 * Component & API regression tests for the apps/web injection audit
 * (docs/security/injection-audit-web.md).
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));

const mockGetChannelAbout = jest.fn();
jest.mock('@/lib/api/channel-profile', () => ({
  getChannelAbout: (...args: unknown[]) => mockGetChannelAbout(...args),
}));

jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.alummahnow.test',
}));

const mockFetchClientAuthInfo = jest.fn();
jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthInfo: (...args: unknown[]) => mockFetchClientAuthInfo(...args),
}));

import { AboutTabContent } from '@/components/ChannelTabs/AboutTabContent';
import ArticlePost from '@/components/Community/types/ArticlePost';
import LinkPost from '@/components/Community/types/LinkPost';
import CardsPost from '@/components/Community/types/CardsPost';
import GifPost from '@/components/Community/types/GifPost';
import { useVideoSubtitles } from '@/hooks/useVideoSubtitles';

describe('Component URL/XSS sanitization regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AboutTabContent drops javascript:/data: links and prevents unsafe mailto hrefs', async () => {
    mockGetChannelAbout.mockResolvedValue({
      id: 'ch1',
      handle: 'scholar',
      description: 'Safe description <script>alert(1)</script>',
      links: [
        { title: 'Good Site', url: 'https://alummahnow.net' },
        { title: 'Evil JS', url: 'javascript:alert(1)' },
        { title: 'Evil Data', url: 'data:text/html,<script>alert(1)</script>' },
      ],
      contactEmail: 'bad@example.com?subject=inject',
      location: 'Amman',
      joinedDate: '2026-01-01T00:00:00Z',
      totalViews: 100,
      videosCount: 5,
      subscribersCount: 10,
    });

    const { container, queryByText } = render(<AboutTabContent channelId="ch1" />);
    await waitFor(() => expect(queryByText('Good Site')).toBeTruthy());

    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://alummahnow.net']);
    expect(queryByText('Evil JS')).toBeNull();
    expect(queryByText('Evil Data')).toBeNull();
    // Unsafe contact email is rendered as plain text (no mailto anchor)
    expect(container.querySelector('[data-testid="about-contact"]')?.tagName).toBe('SPAN');
    expect(container.querySelector('script')).toBeNull();
  });

  it('ArticlePost strips unsafe cover src and javascript: wwwUrl', () => {
    const post = {
      id: 'p1',
      type: 'article',
      article: {
        title: 'Test Article',
        body: 'Hello [bad](javascript:alert(1)) and [good](https://example.org)',
        locale: 'en',
        coverUrl: 'javascript:alert(1)',
        url: 'javascript:alert(2)',
      },
    } as unknown as CommunityPost;

    const { container } = render(<ArticlePost post={post} />);
    expect(container.querySelector('img')).toBeNull();
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://example.org']);
  });

  it('LinkPost rejects javascript: href and strips unsafe preview image src', () => {
    const evilPost = {
      id: 'p2',
      type: 'link',
      link: { url: 'javascript:alert(1)', title: 'Click me' },
    } as unknown as CommunityPost;
    expect(render(<LinkPost post={evilPost} />).container.innerHTML).toBe('');

    const mixedPost = {
      id: 'p3',
      type: 'link',
      link: {
        url: 'https://example.org/post',
        title: 'Good link',
        image: { url: 'data:image/svg+xml,<svg onload=alert(1)>' },
      },
    } as unknown as CommunityPost;
    const { container } = render(<LinkPost post={mixedPost} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.org/post');
    expect(container.querySelector('img')).toBeNull();
  });

  it('CardsPost and GifPost block non-http(s) image src values', () => {
    const cardsPost = {
      id: 'p4',
      type: 'cards',
      slides: [
        { id: 's1', image: { url: 'javascript:alert(1)', alt: 'bad' }, heading: 'Slide 1', position: 'bottom' },
        { id: 's2', image: { url: 'https://cdn.example.org/ok.jpg', alt: 'good' }, heading: 'Slide 2', position: 'bottom' },
      ],
    } as unknown as CommunityPost;
    const cards = render(<CardsPost post={cardsPost} />);
    const imgs = Array.from(cards.container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(imgs).toEqual(['https://cdn.example.org/ok.jpg']);

    const badGif = {
      id: 'p5',
      type: 'gif',
      gif: { url: 'javascript:alert(1)', width: 100, height: 100 },
    } as unknown as CommunityPost;
    expect(render(<GifPost post={badGif} />).container.innerHTML).toBe('');
  });

  it('useVideoSubtitles never sends Authorization header to a third-party subtitle host', async () => {
    const originalFetch = global.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    URL.createObjectURL = jest.fn(() => 'blob:mock-vtt');
    URL.revokeObjectURL = jest.fn();

    try {
      mockFetchClientAuthInfo.mockResolvedValue({ accessToken: 'secret-viewer-token' });
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              restricted: true,
              tracks: [
                { language: 'en', url: 'https://api.alummahnow.test/api/videos/v1/subtitles/en', status: 'ready' },
                { language: 'ar', url: 'https://evil.example/steal-token.vtt', status: 'ready' },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, text: async () => 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi' })
        .mockResolvedValueOnce({ ok: true, text: async () => 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi' });

      function Harness() {
        const tracks = useVideoSubtitles('v1', 'en', true);
        return <div data-count={tracks.length} />;
      }

      const { container, unmount } = render(<Harness />);
      await waitFor(() => expect(container.querySelector('[data-count="2"]')).toBeTruthy());

      const sameOriginCall = fetchMock.mock.calls.find(([u]) => u === 'https://api.alummahnow.test/api/videos/v1/subtitles/en');
      const thirdPartyCall = fetchMock.mock.calls.find(([u]) => u === 'https://evil.example/steal-token.vtt');
      expect(sameOriginCall?.[1]?.headers).toEqual({ Authorization: 'Bearer secret-viewer-token' });
      expect(thirdPartyCall?.[1]?.headers).toBeUndefined();
      unmount();
    } finally {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
