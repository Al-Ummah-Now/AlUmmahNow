import { ACCOUNT_MENU_PATHS, HEADER_PATHS, SIDEBAR_PATHS, unreadBadge } from '../destinations';

describe('navigation destinations', () => {
  it('lists each destination in only one of the sidebar, account menu and header', () => {
    const all = [...Object.values(SIDEBAR_PATHS), ...Object.values(ACCOUNT_MENU_PATHS), ...Object.values(HEADER_PATHS)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('unreadBadge', () => {
  it('shows small counts and caps the rest', () => {
    expect(unreadBadge(1, 'en')).toBe('1');
    expect(unreadBadge(9, 'en')).toBe('9');
    expect(unreadBadge(10, 'en')).toBe('9+');
    expect(unreadBadge(49, 'en')).toBe('9+');
  });
});
