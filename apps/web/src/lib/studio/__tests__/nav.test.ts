import { checkPath, itemPath, STUDIO_NAV, switchedPath, visibleNav, visibleTabs } from '../nav';
import { can, roleForChannel, type StudioRole } from '../permissions';

const ids = (role: StudioRole) => visibleNav(role).map((item) => item.id);
const tabs = (role: StudioRole, id: string) => visibleTabs(role, STUDIO_NAV.find((item) => item.id === id)!).map((tab) => tab.id);

describe('navigation per role', () => {
  it.each<[StudioRole, string[]]>([
    ['owner', ['dashboard', 'content', 'analytics', 'comments', 'playlists', 'customisation', 'settings']],
    ['admin', ['dashboard', 'content', 'analytics', 'comments', 'playlists', 'customisation', 'settings']],
    ['editor', ['dashboard', 'content', 'playlists']],
    ['moderator', ['dashboard', 'content', 'comments']],
  ])('%s sees exactly its items', (role, expected) => {
    expect(ids(role)).toEqual(expected);
  });

  it.each<[StudioRole, string[]]>([
    ['owner', ['videos', 'live', 'posts']],
    ['admin', ['videos', 'live', 'posts']],
    ['editor', ['videos', 'posts']],
    ['moderator', ['live']],
  ])('%s sees exactly its Content tabs', (role, expected) => {
    expect(tabs(role, 'content')).toEqual(expected);
  });

  it('hides the Permissions tab until channel roles ship', () => {
    expect(tabs('owner', 'settings')).toEqual(['general']);
    expect(checkPath('owner', ['settings', 'permissions'])).toEqual({ status: 'unknown' });
  });

  it('opens Content on the first tab the role can use', () => {
    const content = STUDIO_NAV.find((item) => item.id === 'content')!;
    expect(itemPath('owner', content)).toBe('content/videos');
    expect(itemPath('moderator', content)).toBe('content/live');
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
    ['editor', ['content', 'live'], 'forbidden'],
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

  it('treats only the channel owner as having a role', () => {
    expect(roleForChannel({ userId: 'u1' }, 'u1')).toBe('owner');
    expect(roleForChannel({ userId: 'u1' }, 'u2')).toBeNull();
    expect(roleForChannel(null, 'u1')).toBeNull();
  });
});
