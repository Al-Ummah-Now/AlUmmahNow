import { LAST_GOOD_SHELF_KEY, RELATED_LIMIT, loadRelated, mergeRelated, readLastGoodShelf, saveLastGoodShelf, toVideoInfo } from '../related';
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

  it('keeps the title and channel name in every language (an Arabic page shows Arabic ones)', () => {
    const info = toVideoInfo({ id: 'v', title: 'Weak Hadith 2', titleLocalized: { en: 'Weak Hadith 2', ar: 'سلسلة الحديث الضعيف ٢' }, channelName: 'Al Ummah Now', channelNameLocalized: { ar: 'الأمة الآن' } } as never);
    expect(info.titleLocalized).toEqual({ en: 'Weak Hadith 2', ar: 'سلسلة الحديث الضعيف ٢' });
    expect(info.channelNameLocalized).toEqual({ ar: 'الأمة الآن' });
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

    describe('when the sources come back empty', () => {
      const down = () => Promise.reject(new Error('down'));
      const none = async () => [] as VideoInfo[];
      const loadWith = (sources: Parameters<typeof loadRelated>[1]) => loadRelated('cur', sources, RELATED_LIMIT, 0);

      it('does not retry or use a last resort once it has videos', async () => {
        const recommended = jest.fn().mockResolvedValue([info('r1')]);
        const lastResort = jest.fn().mockResolvedValue([info('t1')]);
        await expect(loadWith({ recommended, feed: none, lastResort: [lastResort] })).resolves.toHaveLength(1);
        expect(recommended).toHaveBeenCalledTimes(1);
        expect(lastResort).not.toHaveBeenCalled();
      });

      it('retries once when both sources fail, and uses the retry', async () => {
        const recommended = jest.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue([info('r1')]);
        const feed = jest.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue([info('f1')]);
        const lastResort = jest.fn().mockResolvedValue([info('t1')]);
        const shelf = await loadWith({ recommended, feed, lastResort: [lastResort] });
        expect(shelf.map(v => v.id)).toEqual(['r1', 'f1']);
        expect(recommended).toHaveBeenCalledTimes(2);
        expect(lastResort).not.toHaveBeenCalled();
      });

      it('treats helpers that swallow errors (empty and undefined) as a failure', async () => {
        const recommended = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([info('r1')]);
        const feed = jest.fn().mockResolvedValue(undefined);
        await expect(loadWith({ recommended, feed })).resolves.toHaveLength(1);
        expect(recommended).toHaveBeenCalledTimes(2);
      });

      it('retries only once, then falls through the last resorts in order', async () => {
        const recommended = jest.fn(down);
        const feed = jest.fn(down);
        const trending = jest.fn(down);
        const lastGood = jest.fn(async () => [info('cur'), info('saved')]);
        const shelf = await loadWith({ recommended, feed, lastResort: [trending, lastGood] });
        expect(shelf.map(v => v.id)).toEqual(['saved']);
        expect(recommended).toHaveBeenCalledTimes(2);
        expect(feed).toHaveBeenCalledTimes(2);
        expect(trending).toHaveBeenCalledTimes(1);
      });

      it('moves past a last resort that only holds the current video', async () => {
        const shelf = await loadWith({ recommended: none, feed: none, lastResort: [async () => [info('cur')], async () => [info('t1')]] });
        expect(shelf.map(v => v.id)).toEqual(['t1']);
      });

      it('survives a source that throws synchronously', async () => {
        const boom = () => { throw new Error('sync'); };
        await expect(loadWith({ recommended: boom, feed: boom, lastResort: [boom] })).resolves.toEqual([]);
      });

      it('resolves empty when everything is empty', async () => {
        await expect(loadWith({ recommended: none, feed: none, lastResort: [none] })).resolves.toEqual([]);
      });
    });
  });

  describe('last good shelf', () => {
    beforeEach(() => sessionStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it('round-trips a shelf with real dates', () => {
      saveLastGoodShelf([toVideoInfo({ id: 'v1', title: 'a', createdAt: '2026-11-01T00:00:00.000Z' } as never)]);
      const [restored] = readLastGoodShelf();
      expect(restored.id).toBe('v1');
      expect(restored.dateCreated).toBeInstanceOf(Date);
      expect(restored.dateCreated.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });

    it('does not overwrite a good shelf with an empty one', () => {
      saveLastGoodShelf([info('v1')]);
      saveLastGoodShelf([]);
      expect(readLastGoodShelf().map(v => v.id)).toEqual(['v1']);
    });

    it('ignores corrupt or malformed entries', () => {
      sessionStorage.setItem(LAST_GOOD_SHELF_KEY, '{not json');
      expect(readLastGoodShelf()).toEqual([]);
      sessionStorage.setItem(LAST_GOOD_SHELF_KEY, JSON.stringify({ id: 'x' }));
      expect(readLastGoodShelf()).toEqual([]);
      sessionStorage.setItem(LAST_GOOD_SHELF_KEY, JSON.stringify([null, { title: 'no id' }]));
      expect(readLastGoodShelf()).toEqual([]);
    });

    it('tolerates storage that throws', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      expect(() => saveLastGoodShelf([info('v1')])).not.toThrow();
      expect(readLastGoodShelf()).toEqual([]);
    });
  });
});
