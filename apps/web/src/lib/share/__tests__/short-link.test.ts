/**
 * Share links (wiki AUN-SHORT-LINKS): the short link host per environment, 'off', and the share
 * link with the page's language, falling back to the page URL where there is no short link host.
 */
import { deriveShortLinkUrl } from '@/lib/runtime-config';
import { shareLink } from '@/lib/share/short-link';

describe('deriveShortLinkUrl', () => {
  it('follows the API host, an explicit value wins, off turns it off', () => {
    expect(deriveShortLinkUrl('https://videos.api.alummahnow.net')).toBe('https://alummahnow.link');
    expect(deriveShortLinkUrl('https://videos.api.qa.alummahnow.net')).toBe('https://qa.alummahnow.link');
    expect(deriveShortLinkUrl('https://videos.api.stage.alummahnow.net')).toBe('https://stage.alummahnow.link');
    expect(deriveShortLinkUrl('http://localhost:3086')).toBe('');
    expect(deriveShortLinkUrl('http://localhost:3086', 'http://localhost:3092/')).toBe('http://localhost:3092');
    expect(deriveShortLinkUrl('https://videos.api.alummahnow.net', 'off')).toBe('');
  });
});

describe('shareLink', () => {
  afterEach(() => {
    delete window.__RUNTIME_CONFIG__;
  });

  it('is the short link, with ?lang=ar from Arabic pages only', () => {
    window.__RUNTIME_CONFIG__ = { SHORT_LINK_URL: 'https://alummahnow.link' };
    expect(shareLink({ kind: 'video', id: 'v1' }, 'https://videos.alummahnow.net/en/video/v1', { locale: 'en', t: 30 })).toBe('https://alummahnow.link/v/v1?t=30');
    expect(shareLink({ kind: 'post', id: 'p1' }, 'x', { locale: 'ar' })).toBe('https://alummahnow.link/p/p1?lang=ar');
    expect(shareLink({ kind: 'handle', handle: 'scholar.one' }, 'x')).toBe('https://alummahnow.link/@scholar.one');
    expect(shareLink({ kind: 'video', id: 'v1' }, 'x', { list: { id: 'pl1', index: 2 } })).toBe('https://alummahnow.link/v/v1?list=pl1&index=2');
  });

  it('falls back to the page URL without a short link host or for an id it cannot carry', () => {
    window.__RUNTIME_CONFIG__ = { SHORT_LINK_URL: '' };
    expect(shareLink({ kind: 'video', id: 'v1' }, 'http://localhost:3001/en/video/v1')).toBe('http://localhost:3001/en/video/v1');
    window.__RUNTIME_CONFIG__ = { SHORT_LINK_URL: 'https://alummahnow.link' };
    expect(shareLink({ kind: 'video', id: 'a/b' }, 'fallback')).toBe('fallback');
  });
});
