import { RELATED_LIMIT, loadRelated, mergeRelated, toVideoInfo } from '../related';
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

  describe('loadRelated', () => {
    const many = Array.from({ length: RELATED_LIMIT }, (_, i) => info(`r${i}`));

    it('skips the feed when recommendations fill the shelf', async () => {
      const feed = jest.fn().mockResolvedValue([info('f1')]);
      const shelf = await loadRelated('cur', { recommended: async () => many, feed });
      expect(shelf).toHaveLength(RELATED_LIMIT);
      expect(feed).not.toHaveBeenCalled();
    });

    it('tops up from the feed when recommendations come up short', async () => {
      const shelf = await loadRelated('cur', { recommended: async () => [info('r1')], feed: async () => [info('f1')] });
      expect(shelf.map(v => v.id)).toEqual(['r1', 'f1']);
    });

    it('falls back to the feed when recommendations fail or are empty', async () => {
      const feed = async () => [info('f1')];
      await expect(loadRelated('cur', { recommended: () => Promise.reject(new Error('down')), feed })).resolves.toHaveLength(1);
      await expect(loadRelated('cur', { recommended: async () => [], feed })).resolves.toHaveLength(1);
    });

    it('keeps recommendations when the feed fails', async () => {
      const shelf = await loadRelated('cur', { recommended: async () => [info('r1')], feed: () => Promise.reject(new Error('down')) });
      expect(shelf.map(v => v.id)).toEqual(['r1']);
    });
  });
});
