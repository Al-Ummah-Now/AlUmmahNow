/**
 * @jest-environment node
 */
import { classifyVisit } from '../site-visit';
import { landingKindOf, visitSourceOf } from '@al-ummah/shared-types';

describe('landingKindOf', () => {
  it.each([
    ['/en', 'home'], ['/ar/', 'home'], ['/en/video/abc', 'watch'], ['/ar/shorts/abc', 'shorts'], ['/en/@chan', 'channel'],
    ['/en/channels/c1', 'channel'], ['/en/channels', 'channels'], ['/en/playlist/p1', 'playlist'], ['/en/search?q=x', 'search'],
    ['/en/explore', 'explore'], ['/en/videos', 'videos'], ['/en/live', 'live'], ['/en/history', 'library'], ['/en/upload', 'other'],
  ])('%s → %s', (path, kind) => expect(landingKindOf(path)).toBe(kind));
});

describe('visitSourceOf', () => {
  it.each([
    [null, 'direct'], ['www.google.com', 'search:google'], ['www.google.co.uk', 'search:google'], ['www.bing.com', 'search:bing'],
    ['duckduckgo.com', 'search:duckduckgo'], ['gemini.google.com', 'search:ai'], ['chatgpt.com', 'search:ai'],
    ['t.co', 'social:x'], ['l.facebook.com', 'social:facebook'], ['wa.me', 'social:whatsapp'], ['t.me', 'social:telegram'],
    ['www.alummahnow.net', 'platform'], ['mustafa.alummahnow.net', 'platform'], ['example.org', 'site'],
  ])('%s → %s', (host, source) => expect(visitSourceOf(host)).toBe(source));
});

describe('classifyVisit', () => {
  it('classifies the landing path and referrer, keeping only the referrer host', () => {
    expect(classifyVisit('/ar/video/abc', 'https://www.google.com/search?q=secret', 'videos.alummahnow.net')).toEqual({ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' });
  });
  it('a referrer on this site or none at all is a direct visit', () => {
    expect(classifyVisit('/en', 'https://videos.alummahnow.net/en/video/x', 'videos.alummahnow.net')).toEqual({ landing: 'home', source: 'direct' });
    expect(classifyVisit('/en', '', 'videos.alummahnow.net')).toEqual({ landing: 'home', source: 'direct' });
    expect(classifyVisit('/en', 'not a url', 'videos.alummahnow.net')).toEqual({ landing: 'home', source: 'direct' });
  });
});
