/**
 * "Nothing left → Content opens first" (owner review 2026-11-16). No channel role today lacks
 * every Dashboard section (videos or comments awaiting review), so a role that only manages posts
 * stands in for one: it gets no Dashboard item, and Studio opens Content → Posts.
 */
jest.mock('../permissions', () => ({
  can: (role: string | null, capability: string) => role === 'owner' || (role === 'poster' && capability === 'post.manage'),
}));

import { checkPath, studioHomePath, switchedPath, visibleNav } from '../nav';

describe('a role with none of the Dashboard sections', () => {
  const poster = 'poster' as never;

  it('has no Dashboard item, and Studio opens its first section (Content)', () => {
    expect(visibleNav(poster).map((item) => item.id)).toEqual(['content']);
    expect(studioHomePath(poster)).toBe('content/posts');
    expect(checkPath(poster, ['dashboard']).status).toBe('forbidden');
  });

  it('switching channel from a page it cannot open lands on Content, not an empty Dashboard', () => {
    expect(switchedPath(['analytics'], poster)).toBe('content/posts');
  });

  it('a role with the sections still opens Dashboard', () => {
    expect(studioHomePath('owner' as never)).toBe('dashboard');
  });
});
