import { chooseChannel, safeStudioReturn } from '../resolve';

describe('chooseChannel', () => {
  const channels = [{ id: 'a' }, { id: 'b', isMain: true }, { id: 'c' }];

  it('prefers the active channel', () => expect(chooseChannel(channels, 'c')).toBe('c'));
  it('then the main channel', () => expect(chooseChannel(channels, null)).toBe('b'));
  it('ignores an active channel the account no longer has', () => expect(chooseChannel(channels, 'gone')).toBe('b'));
  it('then the first channel', () => expect(chooseChannel([{ id: 'a' }, { id: 'b' }])).toBe('a'));
  it('is null with no channels', () => expect(chooseChannel([], 'a')).toBeNull());
});

describe('safeStudioReturn', () => {
  it.each(['/en/studio', '/ar/studio/c1/content/videos', '/en/studio/go/analytics'])('allows %s', (path) => {
    expect(safeStudioReturn(path)).toBe(path);
  });

  it.each([
    'https://evil.example/en/studio',
    '//evil.example/en/studio',
    '/en/studio/../../evil',
    '/en/settings',
    '/en/studio?x=1',
    '/fr/studio',
    '/en/studio//evil',
    42,
    undefined,
  ])('refuses %s', (path) => {
    expect(safeStudioReturn(path)).toBeNull();
  });
});
