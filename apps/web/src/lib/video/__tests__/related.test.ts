import { mergeRelated, toVideoInfo } from '../related';
import type { VideoInfo } from '@/interfaces';

const info = (id: string) => toVideoInfo({ id, title: id });

describe('related shelf (Epic 7.3)', () => {
  it('maps the recommendations shape (createdAt, playUrl) to a card', () => {
    const card = toVideoInfo({
      id: 'v1', title: 'Tafsir', channelId: 'c1', channelName: 'Noor', thumbnailUrl: 't.jpg',
      playUrl: 'p.m3u8', views: 12, likesCount: 3, createdAt: '2026-11-01T00:00:00.000Z',
    } as never);
    expect(card).toMatchObject({ id: 'v1', channelName: 'Noor', thumbnail: 't.jpg', video: 'p.m3u8', views: '12', likesCount: 3, dislikesCount: 0 });
    expect(card.dateCreated.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('puts recommendations first, tops up from the feed, skips duplicates and the current video', () => {
    const merged = mergeRelated('cur', [info('r1'), info('cur'), info('r2')], [info('r2'), info('f1'), info('cur'), info('f2')]);
    expect(merged.map((v: VideoInfo) => v.id)).toEqual(['r1', 'r2', 'f1', 'f2']);
  });

  it('caps the shelf at the limit', () => {
    const feed = Array.from({ length: 30 }, (_, i) => info(`f${i}`));
    expect(mergeRelated('cur', [info('r1')], feed, 5).map(v => v.id)).toEqual(['r1', 'f0', 'f1', 'f2', 'f3']);
  });

  it('uses the feed alone when there are no recommendations', () => {
    expect(mergeRelated('cur', [], [info('f1')]).map(v => v.id)).toEqual(['f1']);
  });
});
