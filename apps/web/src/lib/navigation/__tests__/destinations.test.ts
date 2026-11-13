import { ACCOUNT_MENU_PATHS, HEADER_PATHS, SIDEBAR_PATHS, statusPageUrl, unreadBadge } from '../destinations';

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

describe('statusPageUrl', () => {
  it('opens the status page of the env the site runs in', () => {
    expect(statusPageUrl('videos.alummahnow.net', 'en')).toBe('https://status.alummahnow.net/');
    expect(statusPageUrl('videos.qa.alummahnow.net', 'en')).toBe('https://status.qa.alummahnow.net/');
    expect(statusPageUrl('videos.stage.alummahnow.net', 'ar')).toBe('https://status.stage.alummahnow.net/ar');
    expect(statusPageUrl('localhost', 'en')).toBe('https://status.alummahnow.net/');
  });
});
