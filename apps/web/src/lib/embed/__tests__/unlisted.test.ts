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

describe('toEmbedVideo follows the shared visibility rule (#1241)', () => {
  it.each([
    ['still processing', { uploadStatus: 'processing' }],
    ['failed', { uploadStatus: 'failed' }],
    ['scheduled', { scheduledPublishStatus: 'scheduled' }],
    ['being published', { scheduledPublishStatus: 'publishing' }],
    ['a draft', { isDraft: true }],
    ['hidden', { isHidden: true }],
    ['deleted', { isDeleted: true }],
    ['unlisted and processing', { isPublic: false, isUnlisted: true, uploadStatus: 'processing' }],
  ])('never plays a video that is %s', (_name, fields) => {
    expect(toEmbedVideo({ ...base, ...fields })).toBeNull();
  });
  it('plays a ready public video and one the scheduler released', () => {
    expect(toEmbedVideo({ ...base, uploadStatus: 'ready' })).not.toBeNull();
    expect(toEmbedVideo({ ...base, uploadStatus: 'ready', scheduledPublishStatus: 'published' })).not.toBeNull();
  });
});
