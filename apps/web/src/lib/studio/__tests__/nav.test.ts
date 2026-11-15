import { checkPath, itemPath, STUDIO_NAV, studioHomePath, switchedPath, visibleNav, visibleTabs } from '../nav';
import { can, roleForChannel, type StudioRole } from '../permissions';

const LIVE = { live: true };
const ids = (role: StudioRole) => visibleNav(role, LIVE).map((item) => item.id);
const tabs = (role: StudioRole, id: string) => visibleTabs(role, STUDIO_NAV.find((item) => item.id === id)!, LIVE).map((tab) => tab.id);

describe('navigation per role', () => {
  it.each<[StudioRole, string[]]>([
    ['owner', ['dashboard', 'content', 'analytics', 'comments', 'playlists', 'customisation', 'settings']],
    ['admin', ['dashboard', 'content', 'analytics', 'comments', 'playlists', 'customisation', 'settings']],
    ['editor', ['dashboard', 'content', 'playlists']],
    // A moderator reviews Comments and reaches Content → Live (live.moderate)
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

  it('shows the Permissions tab to roles that can see members', () => {
    expect(tabs('owner', 'settings')).toEqual(['general', 'permissions']);
    expect(checkPath('owner', ['settings', 'permissions'])).toEqual({ status: 'ok' });
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
    ['editor', ['content', 'live'], 'forbidden'],
    ['owner', ['content', 'live'], 'ok'],
    ['moderator', ['content', 'live'], 'ok'],
    ['admin', ['content', 'live', 's1'], 'ok'],
    ['moderator', ['content', 'live', 's1'], 'forbidden'],
    ['owner', ['content', 'live', 's1', 'x'], 'unknown'],
    ['moderator', ['content', 'videos'], 'forbidden'],
    ['editor', ['analytics'], 'forbidden'],
    ['editor', ['content', 'videos', 'v1', 'edit'], 'ok'],
    ['editor', ['content', 'videos', 'v1', 'analytics'], 'forbidden'],
    ['admin', ['content', 'videos', 'v1', 'analytics'], 'ok'],
    ['moderator', ['customisation'], 'forbidden'],
    ['editor', ['settings', 'general'], 'forbidden'],
    ['owner', ['content', 'posts', 'new'], 'ok'],
    ['admin', ['content', 'posts', 'p1', 'edit'], 'ok'],
    ['moderator', ['content', 'posts', 'new'], 'forbidden'],
    ['owner', ['content', 'posts', 'p1'], 'unknown'],
    ['owner', ['content', 'posts', 'p1', 'nope'], 'unknown'],
    ['owner', ['playlists'], 'ok'],
    ['moderator', ['comments'], 'ok'],
    ['editor', ['comments'], 'forbidden'],
    ['owner', ['comments', 'x'], 'unknown'],
    ['editor', ['playlists', 'new'], 'ok'],
    ['editor', ['playlists', 'pl1'], 'ok'],
    ['owner', ['playlists', 'pl1', 'x'], 'unknown'],
    ['admin', ['customisation', 'profile'], 'ok'],
    ['owner', ['customisation', 'layout', 'x'], 'unknown'],
    ['owner', ['settings', 'general'], 'ok'],
    ['owner', ['settings', 'permissions', 'x'], 'unknown'],
    ['owner', ['nope'], 'unknown'],
    ['owner', ['dashboard', 'extra'], 'unknown'],
    ['owner', ['content', 'nope'], 'unknown'],
    ['owner', ['content', 'videos', 'v1', 'nope'], 'unknown'],
  ])('%s %j is %s', (role, segments, status) => {
    expect(checkPath(role, segments, LIVE).status).toBe(status);
  });
});

describe('Live off for the channel (GET /api/me/features)', () => {
  const content = STUDIO_NAV.find((item) => item.id === 'content')!;

  it('has no Live tab, and a moderator (Live was its only Content tab) has no Content', () => {
    expect(visibleTabs('owner', content).map((tab) => tab.id)).toEqual(['videos', 'posts']);
    expect(visibleNav('moderator').map((item) => item.id)).toEqual(['dashboard']);
  });

  it('answers not found for Live and a Go live page; a role without access is still "no access"', () => {
    expect(checkPath('owner', ['content', 'live']).status).toBe('unknown');
    expect(checkPath('admin', ['content', 'live', 's1']).status).toBe('unknown');
    expect(checkPath('editor', ['content', 'live']).status).toBe('forbidden');
  });

  it('switching channel from Live lands on Dashboard', () => {
    expect(switchedPath(['content', 'live'], 'owner')).toBe('dashboard');
    expect(switchedPath(['content', 'live'], 'owner', LIVE)).toBe('content/live');
  });
});

describe('where Studio opens (owner review 2026-11-16: no hollow pages)', () => {
  const OFF = { live: false, upload: false, bulkSchedule: false, siteDomains: false, site: false };
  const ON = { live: true, upload: true, bulkSchedule: true, siteDomains: true, site: true };
  it.each<StudioRole>(['owner', 'admin', 'editor', 'moderator'])('%s keeps a Dashboard with every feature on or off', (role) => {
    expect(studioHomePath(role, ON)).toBe('dashboard');
    expect(studioHomePath(role, OFF)).toBe('dashboard');
    expect(studioHomePath(role, {})).toBe('dashboard');
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

describe('Social item (wiki AUN-SOCIAL)', () => {
  const on = { social: true };
  it('is for owners and channel admins (channel.edit), with no tabs', () => {
    expect(checkPath('owner', ['social'], on)).toEqual({ status: 'ok' });
    expect(checkPath('admin', ['social'], on)).toEqual({ status: 'ok' });
    expect(checkPath('editor', ['social'], on)).toEqual({ status: 'forbidden' });
    expect(checkPath('moderator', ['social'], on)).toEqual({ status: 'forbidden' });
    expect(checkPath('owner', ['social', 'x'], on)).toEqual({ status: 'unknown' });
    expect(visibleNav('owner', on).map((item) => item.id)).toContain('social');
  });

  it('is hidden, and its path unknown, while social auto-post is off or no network is set up (socialAutopost)', () => {
    expect(visibleNav('owner', { social: false }).map((item) => item.id)).not.toContain('social');
    expect(checkPath('owner', ['social'], { social: false }).status).toBe('unknown');
  });
});

describe('Site item (white-label scholar sites)', () => {
  it('shows only for owners and channel admins of a channel that has a site', () => {
    const ids = (role: Parameters<typeof visibleNav>[0], site: boolean) => visibleNav(role, { site }).map((i) => i.id);
    expect(ids('owner', true)).toContain('site');
    expect(ids('admin', true)).toContain('site');
    expect(ids('editor', true)).not.toContain('site');
    expect(ids('moderator', true)).not.toContain('site');
    expect(ids('owner', false)).not.toContain('site');
    expect(visibleNav('owner').map((i) => i.id)).not.toContain('site');
  });

  it('opens for channel.edit roles only, and only on a channel that has a site', () => {
    expect(checkPath('owner', ['site'], { site: true })).toEqual({ status: 'ok' });
    expect(checkPath('admin', ['site'], { site: true })).toEqual({ status: 'ok' });
    expect(checkPath('editor', ['site'], { site: true })).toEqual({ status: 'forbidden' });
    // No site: the path is unknown (404), never "no access"
    expect(checkPath('owner', ['site'])).toEqual({ status: 'unknown' });
    // A role without access keeps "no access" either way
    expect(checkPath('editor', ['site'])).toEqual({ status: 'forbidden' });
  });

  it('switching channel never lands on a feature the next channel may not have', () => {
    expect(switchedPath(['site'], 'owner')).toBe('dashboard');
    expect(switchedPath(['site'], 'owner', { site: true })).toBe('site');
  });
});
