import {
  isListAlias,
  nextPosition,
  parseListParams,
  previousPosition,
  readAutoplayNext,
  readListMode,
  shareableList,
  shuffledOrder,
  watchHref,
  writeAutoplayNext,
  writeListMode,
} from '../playback';

const params = (q: string) => new URLSearchParams(q);

describe('watch URL with a list (docs/specs/PLAYLIST-PLAYBACK.md section 2)', () => {
  it('parses list and index, rejecting junk', () => {
    expect(parseListParams(params('list=pl_1-x&index=3'))).toEqual({ list: 'pl_1-x', index: 3 });
    expect(parseListParams(params('list=WL'))).toEqual({ list: 'WL', index: null });
    expect(parseListParams(params('list=pl&index=-1'))).toEqual({ list: 'pl', index: null });
    expect(parseListParams(params('list=pl&index=abc'))).toEqual({ list: 'pl', index: null });
    expect(parseListParams(params('list=../etc'))).toBeNull();
    expect(parseListParams(params('t=30'))).toBeNull();
    expect(parseListParams(null)).toBeNull();
  });

  it('builds the watch URL, with the list and time when given', () => {
    expect(watchHref('en', 'v1')).toBe('/en/video/v1');
    expect(watchHref('ar', 'v1', { list: 'pl', index: 0 })).toBe('/ar/video/v1?list=pl&index=0');
    expect(watchHref('en', 'v1', { list: 'WL', index: 4, t: 75.6 })).toBe('/en/video/v1?list=WL&index=4&t=75');
    expect(watchHref('en', 'v/1', { index: 2 })).toBe('/en/video/v%2F1');
  });

  it('private aliases never go into shared links', () => {
    expect(isListAlias('WL')).toBe(true);
    expect(isListAlias('LL')).toBe(true);
    expect(isListAlias('pl')).toBe(false);
    expect(shareableList('WL')).toBeNull();
    expect(shareableList('LL')).toBeNull();
    expect(shareableList('pl')).toBe('pl');
  });
});

describe('what plays next (D9: stop at the end unless loop)', () => {
  const base = { total: 4, loop: false, shuffle: null };

  it('follows the saved order and stops after the last item', () => {
    expect(nextPosition({ ...base, position: 0 })).toBe(1);
    expect(nextPosition({ ...base, position: 2 })).toBe(3);
    expect(nextPosition({ ...base, position: 3 })).toBeNull();
  });

  it('with loop on, the first item follows the last', () => {
    expect(nextPosition({ ...base, loop: true, position: 3 })).toBe(0);
    expect(previousPosition({ ...base, loop: true, position: 0 })).toBe(3);
    expect(previousPosition({ ...base, position: 0 })).toBeNull();
    expect(previousPosition({ ...base, position: 2 })).toBe(1);
  });

  it('a video that left the list continues from where it was', () => {
    expect(nextPosition({ ...base, position: null, nextPosition: 2 })).toBe(2);
    expect(nextPosition({ ...base, position: null, nextPosition: null })).toBeNull();
    expect(nextPosition({ ...base, loop: true, position: null, nextPosition: null })).toBe(0);
    expect(previousPosition({ ...base, position: null })).toBeNull();
  });

  it('an empty list plays nothing', () => {
    expect(nextPosition({ ...base, total: 0, position: null })).toBeNull();
  });
});

describe('shuffle', () => {
  it('is a deterministic permutation led by the current position', () => {
    const a = shuffledOrder(10, 42, 6);
    expect(a[0]).toBe(6);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(shuffledOrder(10, 42, 6)).toEqual(a);
    expect(shuffledOrder(10, 43, 6)).not.toEqual(a);
  });

  it('next follows the shuffle and stops at its end unless loop', () => {
    const order = shuffledOrder(5, 7, 2);
    const seen = [order[0]];
    let pos: number | null = order[0];
    for (;;) {
      pos = nextPosition({ position: pos, total: 5, loop: false, shuffle: order });
      if (pos === null) break;
      seen.push(pos);
    }
    expect(seen).toEqual(order);
    expect(nextPosition({ position: order[4], total: 5, loop: true, shuffle: order })).toBe(order[0]);
    expect(previousPosition({ position: order[1], total: 5, loop: false, shuffle: order })).toBe(order[0]);
  });
});

describe('preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('Autoplay next is on by default and remembered', () => {
    expect(readAutoplayNext()).toBe(true);
    writeAutoplayNext(false);
    expect(readAutoplayNext()).toBe(false);
    writeAutoplayNext(true);
    expect(readAutoplayNext()).toBe(true);
  });

  it('loop and shuffle are per list and survive junk', () => {
    expect(readListMode('pl')).toEqual({ loop: false, shuffleSeed: null, shuffleFirst: null });
    writeListMode('pl', { loop: true, shuffleSeed: 9, shuffleFirst: 2 });
    expect(readListMode('pl')).toEqual({ loop: true, shuffleSeed: 9, shuffleFirst: 2 });
    expect(readListMode('other').loop).toBe(false);
    window.sessionStorage.setItem('aun.playlist.mode.bad', '{not json');
    expect(readListMode('bad').loop).toBe(false);
  });

  it('a storage that throws falls back to the defaults', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(readAutoplayNext(broken)).toBe(true);
    expect(() => writeAutoplayNext(false, broken)).not.toThrow();
    expect(readListMode('pl', broken).loop).toBe(false);
  });
});
