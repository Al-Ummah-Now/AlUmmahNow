// Local API for the theme sweep (playwright.themes.config.ts): canned answers for what the pages
// read, so signed-in pages render their real layout. Never forwards anything.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_API_PORT || 3158);
const base = `http://127.0.0.1:${port}`;
// Only the sweep's own dev server may call it (never a reflected origin)
const siteOrigin = process.env.THEMES_ORIGIN || 'http://localhost:3157';
const USER = 'theme-sweep-user';
const now = Date.now();
const iso = (h) => new Date(now - h * 3600_000).toISOString();

const thumb = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${(i * 47) % 360} 60% ${i % 2 ? 80 : 25}%)"/><stop offset="1" stop-color="hsl(${(i * 47 + 90) % 360} 50% ${i % 2 ? 95 : 10}%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>`;

const video = (i) => ({
  id: `v${i}`, title: i % 2 ? `درس في التفسير ${i}` : `Lecture on patience, part ${i}`, description: 'Sweep video',
  thumbnailUrl: `${base}/thumb/${i}.svg`, videoUrl: '', userId: 'u2', channel: 'c1', channelId: 'c1',
  channelAvatarUrl: `${base}/thumb/${i + 7}.svg`, channelName: i % 2 ? 'قناة الدروس' : 'Lectures Channel', channelIsVerified: i % 3 === 0,
  dateCreated: iso(i * 20), dateModified: iso(i * 20), createdAt: iso(i * 20), duration: 125 + i * 600, views: 1000 * i + 7,
  likesCount: 3, dislikesCount: 0, commentsCount: 2, isPublic: true, isLive: i === 3, width: 1920, height: 1080, status: 'ready',
});
const VIDEOS = Array.from({ length: 12 }, (_, i) => video(i + 1));
const PROFILE = { id: USER, userId: USER, email: 'sweep@example.test', firstName: 'Theme', lastName: 'Sweep', displayName: 'Theme Sweep', dateCreated: iso(1000) };
// The sweep user's own channel: the channel page and the Studio pages (owner role) render it
const CHANNEL = {
  id: 'c1', userId: USER, name: 'Lectures Channel', nameLocalized: { ar: 'قناة الدروس' }, handle: 'lectures',
  description: 'Weekly lectures on patience, gratitude and the Quran.', avatarUrl: `${base}/thumb/7.svg`, bannerUrl: `${base}/thumb/8.svg`,
  isVerified: true, isMain: true, subscriberCount: 1250, subscribersCount: 1250, videoCount: 12, videosCount: 12,
  dateCreated: iso(2000), dateModified: iso(20), createdAt: iso(2000),
};
const STUDIO_ROWS = VIDEOS.slice(0, 6).map((v, i) => ({
  ...v, channelId: 'c1', userId: USER, isDraft: i === 4, isPublic: i !== 2,
  studioStatus: ['published', 'published', 'published', 'scheduled', 'drafts', 'processing'][i], failureKind: null,
}));
const COMMENTS = [
  { text: 'JazakAllahu khayran, a very clear lecture.', author: { displayName: 'Viewer One', avatarUrl: `${base}/thumb/9.svg` }, h: 3, edited: false },
  { text: 'بارك الله فيكم، درس نافع', author: { displayName: 'مشاهد', avatarUrl: `${base}/thumb/10.svg` }, h: 30, edited: true },
].map((c, i) => ({
  id: `cm${i}`, userId: `u${i + 3}`, channelId: `ch${i + 3}`, videoId: 'v1', text: c.text, dateCreated: iso(c.h), dateModified: iso(c.h),
  likesCount: 4 - i, dislikesCount: 0, repliesCount: 0, isEdited: c.edited, isDeleted: false, isPinned: false, parentCommentId: null,
  author: { userId: `u${i + 3}`, channelId: `ch${i + 3}`, ...c.author },
}));
const NOTIFS = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, category: 'uploads', notificationType: 'upload_ready', notificationKey: 'uploadReady', params: { videoTitle: `WH${i + 10}_1` }, actionUrl: null, entityId: null, isRead: i > 1, createdAt: iso(i * 24 + 1) }));

function answer(path) {
  if (path.startsWith('/thumb/')) return null;
  if (path === '/api/profile' || path === '/api/profiles/me') return PROFILE;
  if (path === '/api/notifications/unread-count') return { success: true, result: { unreadCount: 2 } };
  if (path === '/api/notifications') return { success: true, result: { items: NOTIFS, nextCursor: null, unreadCount: 2 } };
  if (path === '/api/search/suggestions') return { data: [
    { text: 'quran recitation', type: 'query' },
    { text: 'Lectures Channel', type: 'channel', id: 'c1', subtitle: '@lectures', verified: true, thumbnailUrl: `${base}/thumb/3.svg` },
    ...VIDEOS.slice(0, 4).map((v) => ({ text: v.title, type: 'video', id: v.id, subtitle: v.channelName, thumbnailUrl: v.thumbnailUrl })),
    { text: 'Tafsir', type: 'category', count: 12 },
  ] };
  if (/^\/api\/channels\/c1(\/owner)?$/.test(path)) return CHANNEL;
  // Studio Content > Videos: one row per status, and the tab counts
  if (path === '/api/channels/c1/content') return { success: true, result: { items: STUDIO_ROWS, cursor: null } };
  if (path === '/api/channels/c1/content/summary') return { success: true, result: { counts: { published: 9, scheduled: 1, drafts: 1, processing: 1, failed: 0 } } };
  if (/^\/api\/videos\/[^/]+\/comments$/.test(path)) return { success: true, result: { comments: COMMENTS, nextCursor: null, total: COMMENTS.length, sort: 'newest', commentSettings: 'on' } };
  if (/^\/api\/videos\/[^/]+$/.test(path)) return { ...VIDEOS[0], id: path.split('/').pop() };
  if (/videos|search|history|feed|library|watch-later|liked|trending|explore|recommend/.test(path)) return { cursor: '', limit: 12, data: VIDEOS, items: VIDEOS, videos: VIDEOS, success: true, result: { items: VIDEOS, videos: VIDEOS, nextCursor: null } };
  if (/channels/.test(path)) return { success: true, data: [], result: [], items: [], channels: [] };
  return { success: true, data: [], result: [], items: [] };
}

createServer((req, res) => {
  const path = new URL(req.url, base).pathname;
  const cors = { 'access-control-allow-origin': siteOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization, content-type, x-channel-id', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', vary: 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (path.startsWith('/thumb/')) { res.writeHead(200, { ...cors, 'content-type': 'image/svg+xml' }); return res.end(thumb(parseInt(path.slice(7), 10) || 1)); }
  res.writeHead(200, { ...cors, 'content-type': 'application/json' });
  res.end(JSON.stringify(answer(path)));
}).listen(port, '127.0.0.1', () => console.log(`mock api on ${base}`));
