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
  thumbnailUrl: `https://img.example.test/thumb/${i}.svg`, videoUrl: '', userId: 'u2', channel: 'c1', channelId: 'c1',
  channelAvatarUrl: `https://img.example.test/avatar/${i + 7}.svg`, channelName: i % 2 ? 'قناة الدروس' : 'Lectures Channel', channelIsVerified: i % 3 === 0,
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

// Channel-layer fixtures (e2e/themes/channel-layer.spec.ts): answers per access token, so two
// accounts in one browser each have their own channels and creator tier. Other tokens are unchanged.
// Avatars on an https host the page's CSP allows; the mockup browser answers it (specs leave it unanswered)
const avatar = (i) => `https://img.example.test/avatar/${i}.svg`;
const ch = (id, userId, name, ar, role, isMain = false, i = 1) => ({ id, userId, name, nameLocalized: { ar }, avatarUrl: avatar(i), handle: id, isMain, role });
const tier = (over) => ({ tier: { id: 't1', name: 'Scholar', unlimited: false }, via: 'tier', canUpload: true, canCreateChannel: true, channelsOwned: 0, maxChannels: 3, limits: null, usage: { hour: 0, day: 0 }, ...over });
export const CHANNEL_FIXTURES = {
  // Aisha: owns two channels (her tier allows two: at the limit) and manages one of Omar's
  'nav-aisha': {
    channels: [ch('a1', 'nav-a', 'Tafsir Lessons', 'دروس التفسير', 'owner', true, 2), ch('a2', 'nav-a', 'Hadith Circle', 'حلقة الحديث', 'owner', false, 3), ch('b1', 'nav-b', 'Seerah Weekly', 'السيرة أسبوعيًا', 'admin', false, 4)],
    creator: tier({ canCreateChannel: false, channelsOwned: 2, maxChannels: 2 }),
    profile: { id: 'nav-a', userId: 'nav-a', email: 'aisha@example.com', firstName: 'Aisha', lastName: 'Rahman', displayName: 'Aisha Rahman', displayNameLocalized: { ar: 'عائشة رحمن' } },
  },
  // Omar: owns three channels, may create more
  'nav-omar': {
    channels: [ch('b1', 'nav-b', 'Seerah Weekly', 'السيرة أسبوعيًا', 'owner', true, 4), ch('b2', 'nav-b', 'Arabic Basics', 'أساسيات العربية', 'owner', false, 5), ch('b3', 'nav-b', 'Fiqh Q&A', 'أسئلة الفقه', 'owner', false, 6)],
    creator: tier({ channelsOwned: 3, maxChannels: 5 }),
    profile: { id: 'nav-b', userId: 'nav-b', email: 'omar@example.com', firstName: 'Omar', lastName: 'Khalid', displayName: 'Omar Khalid', displayNameLocalized: { ar: 'عمر خالد' } },
  },
  // Hana: her tier said she could create one more, but another tab used it up: the create is refused
  // (channel_limit) and the tier, read again, is at its limit
  'nav-race': {
    channels: [ch('h1', 'nav-h', 'Quran Recitation', 'تلاوة القرآن', 'owner', true, 7)],
    creator: tier({ channelsOwned: 1, maxChannels: 2 }),
    refuseCreate: tier({ canCreateChannel: false, channelsOwned: 2, maxChannels: 2 }),
  },
  // A viewer: no channel, no creator tier (uploads and channels are by invitation)
  'nav-viewer': {
    channels: [],
    creator: { tier: null, via: 'none', canUpload: false, canCreateChannel: false, channelsOwned: 0, maxChannels: null, limits: null, usage: { hour: 0, day: 0 } },
  },
};

const FIXTURE_START = JSON.stringify(CHANNEL_FIXTURES);
/** Back to the start (each test that changes a fixture resets it first). */
function resetFixtures() {
  const start = JSON.parse(FIXTURE_START);
  for (const key of Object.keys(CHANNEL_FIXTURES)) CHANNEL_FIXTURES[key] = start[key];
}

function fixtureAnswer(path, token, method) {
  const f = CHANNEL_FIXTURES[token];
  if (!f) return undefined;
  if (path === '/api/channels/access') return { status: 200, body: { success: true, data: f.channels } };
  if ((path === '/api/profile' || path === '/api/profiles/me') && f.profile) return { status: 200, body: { ...PROFILE, ...f.profile } };
  if (path === '/api/me/creator') return { status: 200, body: { success: true, result: f.creator } };
  // Creating a channel past the tier's limit is refused the way api-videos refuses it
  if (path === '/api/channels' && method === 'POST' && (f.refuseCreate || !f.creator.canCreateChannel)) {
    if (f.refuseCreate) f.creator = f.refuseCreate;
    return { status: 403, body: { success: false, error: 'channel_limit', code: 'channel_limit', maxChannels: f.creator.maxChannels } };
  }
  return undefined;
}

function answer(path) {
  if (path.startsWith('/thumb/')) return null;
  if (path === '/api/profile' || path === '/api/profiles/me') return PROFILE;
  if (path === '/api/notifications/unread-count') return { success: true, result: { unreadCount: 2, unseenCount: 2, menuOpen: 'seen' } };
  if (path === '/api/notifications') return { success: true, result: { items: NOTIFS, nextCursor: null, unreadCount: 2, unseenCount: 2, menuOpen: 'seen' } };
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
  if (path === '/__fixtures/reset') { resetFixtures(); res.writeHead(204, cors); return res.end(); }
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const fixture = fixtureAnswer(path, token, req.method);
  if (fixture) {
    res.writeHead(fixture.status, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify(fixture.body));
  }
  res.writeHead(200, { ...cors, 'content-type': 'application/json' });
  res.end(JSON.stringify(answer(path)));
}).listen(port, '127.0.0.1', () => console.log(`mock api on ${base}`));
