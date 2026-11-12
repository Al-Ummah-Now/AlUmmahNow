import { pickUpNext, recordWatched, watchedThisSession } from '../up-next';

const long = (id: string) => ({ id, width: 1280, height: 720, duration: 600 });
const short = (id: string) => ({ id, width: 720, height: 1280, duration: 30 });

describe('Up next outside a playlist (the owner\'s "auto play like youtube")', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('the first related video of the same format comes next and leads the list', () => {
    const related = [short('s1'), long('l1'), long('l2')];
    const { next, ordered } = pickUpNext(long('now'), related, []);
    expect(next?.id).toBe('l1');
    expect(ordered.map((v) => v.id)).toEqual(['l1', 's1', 'l2']);
    // A Short goes to a Short
    expect(pickUpNext(short('now'), related, []).next?.id).toBe('s1');
  });

  it('skips videos already watched this session and the playing video', () => {
    const related = [long('now'), long('l1'), long('l2')];
    expect(pickUpNext(long('now'), related, ['l1']).next?.id).toBe('l2');
    expect(pickUpNext(long('now'), related, ['l1']).ordered.map((v) => v.id)).toEqual(['l2', 'l1']);
  });

  it('no video of the same format left: nothing plays on its own', () => {
    expect(pickUpNext(long('now'), [short('s1')], []).next).toBeNull();
    expect(pickUpNext(long('now'), [long('l1')], ['l1']).next).toBeNull();
  });

  it('an explicit isShort flag wins over the dimensions', () => {
    expect(pickUpNext({ id: 'now', isShort: true }, [long('l1'), { id: 'x', isShort: true }], []).next?.id).toBe('x');
  });

  it('remembers watched videos per tab, newest last, without duplicates', () => {
    recordWatched('a');
    recordWatched('b');
    recordWatched('a');
    expect(watchedThisSession()).toEqual(['b', 'a']);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(watchedThisSession(broken)).toEqual([]);
    expect(() => recordWatched('c', broken)).not.toThrow();
  });
});
