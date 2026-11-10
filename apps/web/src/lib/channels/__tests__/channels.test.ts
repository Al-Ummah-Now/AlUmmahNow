/**
 * @jest-environment node
 */
import type { ChannelRole } from '@al-ummah/shared-types';
import { buildChannelMenu, sameChannelList, type MenuChannel } from '../menu';
import { cacheChannels, isCacheableChannel, toSessionChannel, MAX_CACHED_CHANNELS, type SessionChannel } from '../session-cache';
import { canOpenSettingsPage, roleMeets, CHANNEL_SETTINGS_PAGES } from '../permissions';
import { normalizeChannelFailure } from '../report-shape';

const ME = 'usr_me';
const ch = (id: string, over: Partial<MenuChannel> = {}): MenuChannel => ({ id, userId: ME, name: id, isMain: false, ...over });

describe('buildChannelMenu', () => {
  it('groups owned channels under "Your channels" and role channels under "Channels you manage"', () => {
    const sections = buildChannelMenu([
      ch('b-owned'),
      ch('mostafa', { userId: 'usr_other', role: 'admin', name: 'Mostafa' }),
      ch('a-main', { isMain: true, role: 'owner' }),
      ch('mod', { userId: 'usr_other', role: 'moderator', name: 'Aaa' }),
      ch('ed', { userId: 'usr_x', role: 'editor', name: 'Zed' }),
    ], ME);
    expect(sections.map((s) => s.key)).toEqual(['owned', 'managed']);
    // Main first, then by name
    expect(sections[0].items.map((c) => c.id)).toEqual(['a-main', 'b-owned']);
    expect(sections[0].items.every((c) => c.role === 'owner')).toBe(true);
    // By role (admin, editor, moderator), then name
    expect(sections[1].items.map((c) => [c.id, c.role])).toEqual([['mostafa', 'admin'], ['ed', 'editor'], ['mod', 'moderator']]);
  });

  it('lists a channel once, owned winning over a duplicate role entry', () => {
    const sections = buildChannelMenu([ch('x', { role: 'owner' }), ch('x', { role: 'admin' }), ch('y', { userId: 'u2', role: 'editor' }), ch('y', { userId: 'u2', role: 'editor' })], ME);
    expect(sections.flatMap((s) => s.items.map((c) => c.id))).toEqual(['x', 'y']);
    expect(sections[0].items[0].role).toBe('owner');
  });

  it('leaves out empty groups', () => {
    expect(buildChannelMenu([ch('only')], ME).map((s) => s.key)).toEqual(['owned']);
    expect(buildChannelMenu([ch('m', { userId: 'u2', role: 'editor' })], ME).map((s) => s.key)).toEqual(['managed']);
    expect(buildChannelMenu([], ME)).toEqual([]);
  });

  it('treats role-less cached entries as owned only when they are the account\'s, and drops someone else\'s', () => {
    const sections = buildChannelMenu([ch('mine'), ch('legacy', { userId: '' }), ch('stale', { userId: 'usr_other' })], ME);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((c) => c.id).sort()).toEqual(['legacy', 'mine']);
  });

  it('never shows a channel as owned when it belongs to someone else', () => {
    const sections = buildChannelMenu([ch('forged', { userId: 'usr_other', role: 'owner' })], ME);
    expect(sections).toEqual([]);
  });

  it('a revoked role disappears from the menu with the live list', () => {
    const before = buildChannelMenu([ch('mine'), ch('theirs', { userId: 'u2', role: 'admin' })], ME);
    const after = buildChannelMenu([ch('mine')], ME);
    expect(before.map((s) => s.key)).toEqual(['owned', 'managed']);
    expect(after.map((s) => s.key)).toEqual(['owned']);
  });
});

describe('sameChannelList', () => {
  it('ignores order but sees role, name, avatar and main changes', () => {
    const a = [ch('1', { role: 'owner' }), ch('2', { userId: 'u', role: 'editor' })];
    expect(sameChannelList(a, [...a].reverse())).toBe(true);
    expect(sameChannelList(a, [a[0], { ...a[1], role: 'admin' as ChannelRole }])).toBe(false);
    expect(sameChannelList(a, [a[0], { ...a[1], name: 'renamed' }])).toBe(false);
    expect(sameChannelList(a, [a[0]])).toBe(false);
  });
});

describe('session cache', () => {
  const sc = (id: string, over: Partial<SessionChannel> = {}): SessionChannel => ({ id, userId: ME, name: id, isMain: false, ...over } as SessionChannel);

  it('keeps only first-paint fields and the role', () => {
    const slim = toSessionChannel({ id: 'c', userId: ME, name: 'C', isMain: true, description: 'long text', role: 'owner', handle: 'h' } as never);
    expect(slim).toEqual({ id: 'c', userId: ME, name: 'C', isMain: true, role: 'owner' });
  });

  it('keeps the active channel first and caps the cache', () => {
    const many = Array.from({ length: 12 }, (_, i) => sc(`c${i}`));
    const cached = cacheChannels(many, ME, 'c11');
    expect(cached).toHaveLength(MAX_CACHED_CHANNELS);
    expect(cached[0].id).toBe('c11');
  });

  it('accepts owned entries and others\' channels only with a member role', () => {
    expect(isCacheableChannel(sc('a'), ME)).toBe(true);
    expect(isCacheableChannel(sc('b', { userId: 'u2', role: 'editor' }), ME)).toBe(true);
    expect(isCacheableChannel(sc('c', { userId: 'u2' }), ME)).toBe(false);
    expect(isCacheableChannel(sc('d', { userId: 'u2', role: 'owner' }), ME)).toBe(false);
    expect(isCacheableChannel(sc('e', { role: 'admin' }), ME)).toBe(false);
  });
});

describe('channel settings page permissions', () => {
  it('opens each page only for roles that can use it', () => {
    const open = (role: ChannelRole | null) => (Object.keys(CHANNEL_SETTINGS_PAGES) as Array<keyof typeof CHANNEL_SETTINGS_PAGES>).filter((p) => canOpenSettingsPage(role, p));
    expect(open('owner')).toEqual(['overview', 'edit', 'videos', 'playlists', 'tabs', 'sections', 'community', 'team']);
    expect(open('admin')).toEqual(['overview', 'edit', 'videos', 'playlists', 'tabs', 'sections', 'team']);
    expect(open('editor')).toEqual(['overview', 'videos', 'playlists', 'team']);
    expect(open('moderator')).toEqual(['overview', 'team']);
    expect(open(null)).toEqual([]);
  });

  it('roleMeets: any, owner, capability', () => {
    expect(roleMeets('moderator', 'any')).toBe(true);
    expect(roleMeets(undefined, 'any')).toBe(false);
    expect(roleMeets('admin', 'owner')).toBe(false);
    expect(roleMeets('editor', 'video.upload')).toBe(true);
    expect(roleMeets('moderator', 'video.upload')).toBe(false);
    expect(roleMeets('editor', 'playlist.manage')).toBe(true);
    expect(roleMeets('moderator', 'playlist.manage')).toBe(false);
  });
});

describe('channel failure reports', () => {
  it('keeps short machine-readable fields only', () => {
    expect(normalizeChannelFailure({ reason: 'http', status: 503, action: 'menu', code: 'member_limit', extra: 'x' }))
      .toEqual({ reason: 'http', status: 503, action: 'menu', code: 'member_limit' });
    expect(normalizeChannelFailure({ reason: 'has spaces and <html>' })).toBeNull();
    expect(normalizeChannelFailure({ reason: 'network', status: 'x', action: 'a'.repeat(80) })).toEqual({ reason: 'network' });
    expect(normalizeChannelFailure(null)).toBeNull();
  });
});
