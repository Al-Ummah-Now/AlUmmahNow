import { checkPath, itemPath, legacyHref, STUDIO_NAV, switchedPath, visibleNav, visibleTabs } from '../nav';
import { can, roleForChannel, type StudioRole } from '../permissions';

const ids = (role: StudioRole) => visibleNav(role).map((item) => item.id);
const tabs = (role: StudioRole, id: string) => visibleTabs(role, STUDIO_NAV.find((item) => item.id === id)!).map((tab) => tab.id);

describe('navigation per role', () => {
  it.each<[StudioRole, string[]]>([
    ['owner', ['dashboard', 'content', 'analytics', 'playlists', 'customisation', 'settings']],
    ['admin', ['dashboard', 'content', 'analytics', 'playlists', 'customisation', 'settings']],
    ['editor', ['dashboard', 'content', 'playlists']],
    // Comments and Live have no creator page yet
    ['moderator', ['dashboard']],
  ])('%s sees exactly its items', (role, expected) => {
    expect(ids(role)).toEqual(expected);
  });

  it.each<[StudioRole, string[]]>([
    ['owner', ['videos', 'posts']],
    ['admin', ['videos', 'posts']],
    ['editor', ['videos', 'posts']],
    ['moderator', []],
  ])('%s sees exactly its Content tabs', (role, expected) => {
    expect(tabs(role, 'content')).toEqual(expected);
  });

  it('shows the Permissions tab to roles that can see members', () => {
    expect(tabs('owner', 'settings')).toEqual(['general', 'permissions']);
    expect(checkPath('owner', ['settings', 'permissions'])).toEqual({ status: 'ok' });
  });

  it('opens the existing channel settings pages for sections Studio has not rebuilt', () => {
    expect(legacyHref('ar', 'c1', 'playlists')).toBe('/ar/settings/channel/c1/playlists');
    expect(legacyHref('en', 'c1', 'content/posts/new')).toBe('/en/settings/channel/c1/community/new');
    expect(legacyHref('en', 'c1', 'customisation/profile')).toBe('/en/settings/channel/c1/edit');
    expect(legacyHref('en', 'c1', 'settings/general')).toBe('/en/settings/channel/c1');
    expect(legacyHref('en', 'c1', 'settings/permissions')).toBe('/en/settings/channel/c1/team');
    expect(legacyHref('en', 'c1', 'content/videos')).toBeNull();
  });

  it('opens Content on the first tab the role can use', () => {
    const content = STUDIO_NAV.find((item) => item.id === 'content')!;
    expect(itemPath('owner', content)).toBe('content/videos');
    expect(itemPath('editor', content)).toBe('content/videos');
  });
});

describe('checkPath', () => {
  it.each<[StudioRole, string[], string]>([
    ['owner', ['dashboard'], 'ok'],
    ['moderator', ['dashboard'], 'ok'],
    ['owner', ['content'], 'redirect'],
    ['owner', ['customisation'], 'redirect'],
    ['owner', ['settings'], 'redirect'],
    ['owner', ['content', 'videos'], 'ok'],
    ['editor', ['content', 'live'], 'unknown'],
    ['moderator', ['content', 'videos'], 'forbidden'],
    ['editor', ['analytics'], 'forbidden'],
    ['editor', ['content', 'videos', 'v1', 'edit'], 'ok'],
    ['editor', ['content', 'videos', 'v1', 'analytics'], 'forbidden'],
    ['admin', ['content', 'videos', 'v1', 'analytics'], 'ok'],
    ['moderator', ['customisation'], 'forbidden'],
    ['editor', ['settings', 'general'], 'forbidden'],
    ['owner', ['content', 'posts', 'new'], 'ok'],
    ['owner', ['nope'], 'unknown'],
    ['owner', ['dashboard', 'extra'], 'unknown'],
    ['owner', ['content', 'nope'], 'unknown'],
    ['owner', ['content', 'videos', 'v1', 'nope'], 'unknown'],
  ])('%s %j is %s', (role, segments, status) => {
    expect(checkPath(role, segments).status).toBe(status);
  });
});

describe('switchedPath', () => {
  it('keeps the page and tab', () => {
    expect(switchedPath(['content', 'posts'], 'owner')).toBe('content/posts');
    expect(switchedPath(['analytics'], 'owner')).toBe('analytics');
  });

  it('drops a nested id', () => {
    expect(switchedPath(['content', 'videos', 'v1', 'edit'], 'owner')).toBe('content/videos');
  });

  it('goes to Dashboard when the role can\'t open the page', () => {
    expect(switchedPath(['analytics'], 'editor')).toBe('dashboard');
    expect(switchedPath(['content', 'videos'], 'moderator')).toBe('dashboard');
  });
});

describe('permissions', () => {
  it('gives no one a capability without a role', () => {
    expect(can(null, 'channel.edit')).toBe(false);
  });

  it('limits the handle, deletion and admin changes to the owner', () => {
    for (const capability of ['channel.handle', 'channel.delete', 'members.manage_admins'] as const) {
      expect(can('owner', capability)).toBe(true);
      expect(can('admin', capability)).toBe(false);
    }
  });

  it('keeps stats to the owner and admin', () => {
    expect(can('editor', 'analytics.view')).toBe(false);
    expect(can('moderator', 'analytics.view')).toBe(false);
  });

  it('gives channel members their role from the channel record', () => {
    const channel = { userId: 'u1', members: [{ userId: 'u3', role: 'editor', addedAt: '2026-01-01T00:00:00.000Z', addedBy: 'u1' }] };
    expect(roleForChannel(channel, 'u3')).toBe('editor');
  });

  it('treats the owner as owner and a stranger as no role', () => {
    expect(roleForChannel({ userId: 'u1' }, 'u1')).toBe('owner');
    expect(roleForChannel({ userId: 'u1' }, 'u2')).toBeNull();
    expect(roleForChannel(null, 'u1')).toBeNull();
  });
});
