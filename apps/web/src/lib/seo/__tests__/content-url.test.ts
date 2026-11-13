/**
 * @jest-environment node
 *
 * VideoObject contentUrl (D-SEO-11, wiki AUN-SEO): the API's stable public MP4 reaches the watch
 * page's JSON-LD for public videos only.
 */
import { videoObjectLd } from '../structured-data';

// React.cache exists in Next's server React build, not in the react@18 test copy
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toEmbedVideo } = require('@/lib/embed/content') as typeof import('@/lib/embed/content');

const O = 'https://videos.alummahnow.net';
const MP4 = 'https://media.alummahnow.net/pub/v1/480p.mp4';
const api = (extra: Record<string, unknown> = {}) => ({ id: 'v1', title: 'Talk', playUrl: 'https://x/playlist.m3u8', isPublic: true, ...extra });

describe('contentUrl from the API to the VideoObject', () => {
  it('a public video with the API contentUrl carries it into the VideoObject', () => {
    const video = toEmbedVideo(api({ contentUrl: MP4 }));
    expect(video?.contentUrl).toBe(MP4);
    expect(videoObjectLd(video!, 'en', O).contentUrl).toBe(MP4);
    expect(videoObjectLd(video!, 'ar', O).contentUrl).toBe(MP4);
  });

  it('no contentUrl from the API (Bunny-only video): none in the VideoObject', () => {
    const video = toEmbedVideo(api());
    expect(video).not.toHaveProperty('contentUrl');
    expect(videoObjectLd(video!, 'en', O)).not.toHaveProperty('contentUrl');
  });

  it('an unlisted video never carries one, even if the API sent it', () => {
    const video = toEmbedVideo(api({ isPublic: false, isUnlisted: true, contentUrl: MP4 }));
    expect(video?.isUnlisted).toBe(true);
    expect(video).not.toHaveProperty('contentUrl');
    expect(videoObjectLd({ ...video!, contentUrl: MP4 }, 'en', O)).not.toHaveProperty('contentUrl');
  });

  it('a private video does not load at all', () => {
    expect(toEmbedVideo(api({ isPublic: false, contentUrl: MP4 }))).toBeNull();
  });

  it('only an absolute https URL is passed on', () => {
    for (const bad of ['http://media.alummahnow.net/a.mp4', '/pub/a.mp4', 'javascript:alert(1)', '', 42]) {
      expect(toEmbedVideo(api({ contentUrl: bad }))).not.toHaveProperty('contentUrl');
    }
  });
});
