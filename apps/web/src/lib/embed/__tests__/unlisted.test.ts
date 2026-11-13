/**
 * @jest-environment node
 */
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { toEmbedVideo } from '../content';

const base = { id: 'v1', title: 'Talk', playUrl: 'https://vz.example/v1/playlist.m3u8' };

describe('toEmbedVideo and visibility (D-SEO-5)', () => {
  it('plays an unlisted video for anyone with the link and marks it', () => {
    expect(toEmbedVideo({ ...base, isPublic: false, isUnlisted: true })).toMatchObject({ id: 'v1', isUnlisted: true });
  });
  it('never plays a private video', () => {
    expect(toEmbedVideo({ ...base, isPublic: false })).toBeNull();
  });
  it('a public video is not marked unlisted', () => {
    expect(toEmbedVideo({ ...base, isPublic: true, isUnlisted: true })?.isUnlisted).toBeUndefined();
  });
});
