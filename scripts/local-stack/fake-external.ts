/**
 * Fakes of the third parties the local stack's workers call (registered in outbound.ts FAKES), and
 * the fake CDN the browser reaches (an HTTP server on PORTS['fake-cdn']; Playwright routes the
 * real CDN hosts to it, see apps/web/e2e/local-stack.ts).
 *
 * - Bunny Stream API (video.bunnycdn.com): create/get/update/delete/list videos, raw PUT upload,
 *   TUS (/tusupload: create, HEAD, PATCH with offsets, DELETE), thumbnails, statistics.
 * - Encoding on demand: an upload that completes is "processing"; it becomes encoded (status 4,
 *   with the duration/size read from the uploaded MP4) after FAKE_BUNNY_ENCODE_MS (default 2000),
 *   or never with FAKE_BUNNY_ENCODE=manual. Tests drive it through the control API:
 *   POST /__fake/bunny/videos/<guid>/encode | /fail | /hold, GET /__fake/bunny/videos.
 * - Bunny CDN (FAKE_CDN_HOST): HLS (the player fixtures: landscape, or the short one for vertical
 *   videos), thumbnail.jpg / thumbnail_N.jpg / preview.webp, play_<res>p.mp4, original.
 * - Bunny Storage (storage.bunnycdn.com) + the image host (images.alummahnow.net): PUT stores, GET serves.
 * - Resend (api.resend.com): emails are kept, never sent: GET /__fake/resend/emails.
 *
 * State is in memory and dies with the stack, like every other piece of local state.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { FAKES } from './outbound.ts';
import { PORTS, ROOT } from './stack.ts';

/** The CDN hostname api-videos signs and the browser loads (Playwright routes it to the fake CDN). */
export const FAKE_CDN_HOST = 'vz-local-stack.b-cdn.net';
export const IMAGE_HOST = 'images.alummahnow.net';

const PLAYER_FIXTURES = join(ROOT, 'apps/web/e2e/player/fixtures');
const THUMBNAIL = join(ROOT, 'apps/web/e2e/test-fixtures/e2e-thumbnail.jpg');
const ENCODE_MODE = process.env.FAKE_BUNNY_ENCODE === 'manual' ? 'manual' : 'auto';
const ENCODE_MS = Number(process.env.FAKE_BUNNY_ENCODE_MS ?? 2000);

interface FakeVideo {
  guid: string;
  title: string;
  collectionId: string;
  /** Bunny status: 0 created, 1 uploaded, 2 processing, 3 transcoding, 4 finished, 5 error, 6 upload failed */
  status: number;
  encodeProgress: number;
  length: number;
  width: number;
  height: number;
  storageSize: number;
  availableResolutions: string | null;
  thumbnailFileName: string | null;
  dateUploaded: string;
  hold: boolean;
  bytes: Buffer;
}
interface FakeUpload {
  id: string;
  guid: string;
  length: number;
  offset: number;
  chunks: Buffer[];
}

export const bunny = { videos: new Map<string, FakeVideo>(), uploads: new Map<string, FakeUpload>() };
export const storage = new Map<string, { body: Buffer; type: string }>();
export const emails: unknown[] = [];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Duration (s) and the first video track's size from an MP4's mvhd/tkhd boxes; zeros when unreadable. */
export function probeMp4(buf: Buffer): { length: number; width: number; height: number } {
  let length = 0;
  let width = 0;
  let height = 0;
  const mvhd = buf.indexOf('mvhd');
  if (mvhd > 4) {
    const v = buf[mvhd + 4];
    const timescale = v === 1 ? buf.readUInt32BE(mvhd + 24) : buf.readUInt32BE(mvhd + 16);
    const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd + 28)) : buf.readUInt32BE(mvhd + 20);
    if (timescale) length = Math.round(duration / timescale);
  }
  for (let at = buf.indexOf('tkhd'); at > 4; at = buf.indexOf('tkhd', at + 4)) {
    const v = buf[at + 4];
    const base = at + 4 + (v === 1 ? 88 : 76);
    if (base + 8 > buf.length) break;
    const w = buf.readUInt32BE(base) >>> 16;
    const h = buf.readUInt32BE(base + 4) >>> 16;
    if (w && h) {
      width = w;
      height = h;
      break;
    }
  }
  return { length, width, height };
}

function newVideo(title: string, guid: string = crypto.randomUUID()): FakeVideo {
  const video: FakeVideo = {
    guid, title, collectionId: '', status: 0, encodeProgress: 0, length: 0, width: 0, height: 0, storageSize: 0,
    availableResolutions: null, thumbnailFileName: null, dateUploaded: new Date().toISOString(), hold: ENCODE_MODE === 'manual', bytes: Buffer.alloc(0),
  };
  bunny.videos.set(guid, video);
  return video;
}

export function encode(video: FakeVideo): void {
  const probe = probeMp4(video.bytes);
  Object.assign(video, {
    status: 4,
    encodeProgress: 100,
    // What the CDN serves is the player's HLS fixture (landscape 90 s, vertical 12 s): report its length
    length: (probe.height || 720) > (probe.width || 1280) ? 12 : 90,
    width: probe.width || 1280,
    height: probe.height || 720,
    availableResolutions: (probe.height || 720) > (probe.width || 1280) ? '240p,360p,480p,720p' : '240p,360p,720p',
    thumbnailFileName: 'thumbnail.jpg',
  });
}

function uploaded(video: FakeVideo, bytes: Buffer): void {
  video.bytes = bytes;
  video.storageSize = bytes.length;
  video.status = 2;
  if (!video.hold) setTimeout(() => video.status !== 4 && video.status !== 5 && encode(video), ENCODE_MS).unref();
}

const publicVideo = ({ bytes: _b, hold: _h, ...video }: FakeVideo) => ({ videoLibraryId: 424242, views: 0, isPublic: false, ...video });

async function bunnyStream(request: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean);
  // TUS: /tusupload[/<id>]
  if (parts[0] === 'tusupload') {
    const headers = { 'Tus-Resumable': '1.0.0' };
    if (request.method === 'POST' && parts.length === 1) {
      const guid = request.headers.get('VideoId') ?? '';
      const video = bunny.videos.get(guid) ?? newVideo('', guid);
      const upload: FakeUpload = { id: crypto.randomUUID(), guid: video.guid, length: Number(request.headers.get('Upload-Length') ?? 0), offset: 0, chunks: [] };
      bunny.uploads.set(upload.id, upload);
      video.status = 0;
      return new Response(null, { status: 201, headers: { ...headers, Location: `/tusupload/${upload.id}`, 'Upload-Offset': '0' } });
    }
    const upload = bunny.uploads.get(parts[1] ?? '');
    if (!upload) return new Response('upload not found', { status: 404, headers });
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Upload-Offset': String(upload.offset), 'Upload-Length': String(upload.length), 'Cache-Control': 'no-store' } });
    if (request.method === 'DELETE') {
      bunny.uploads.delete(upload.id);
      return new Response(null, { status: 204, headers });
    }
    if (request.method === 'PATCH') {
      if (Number(request.headers.get('Upload-Offset')) !== upload.offset) return new Response('offset mismatch', { status: 409, headers });
      const chunk = Buffer.from(await request.arrayBuffer());
      upload.chunks.push(chunk);
      upload.offset += chunk.length;
      if (upload.length && upload.offset >= upload.length) {
        const video = bunny.videos.get(upload.guid);
        if (video) uploaded(video, Buffer.concat(upload.chunks));
      }
      return new Response(null, { status: 204, headers: { ...headers, 'Upload-Offset': String(upload.offset) } });
    }
    return new Response('method not allowed', { status: 405, headers });
  }
  // Stream API: /library/<lib>/videos[/<id>[/<action>]] and /library/<lib>/statistics
  if (parts[0] !== 'library') return json({ message: 'not faked' }, 404);
  if (parts[2] === 'statistics') return json({ viewsChart: {}, watchTimeChart: {}, totalWatchTime: 0, engagementScore: 0 });
  if (parts[2] === 'collections') return json(request.method === 'GET' && !parts[3] ? { items: [], totalItems: 0, currentPage: 1, itemsPerPage: 100 } : { guid: parts[3] ?? crypto.randomUUID(), name: 'local', videoCount: 0 });
  if (parts[2] !== 'videos') return json({ message: 'not faked' }, 404);
  const id = parts[3];
  if (!id) {
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { title?: string; collectionId?: string };
      const video = newVideo(body.title ?? '');
      video.collectionId = body.collectionId ?? '';
      return json(publicVideo(video));
    }
    const items = [...bunny.videos.values()].map(publicVideo);
    return json({ items, totalItems: items.length, currentPage: 1, itemsPerPage: items.length || 1000 });
  }
  const video = bunny.videos.get(id);
  if (!video) return json({ success: false, message: 'Video not found', statusCode: 404 }, 404);
  const action = parts[4];
  if (action === 'thumbnail') {
    video.thumbnailFileName = 'thumbnail.jpg';
    return json({ success: true, statusCode: 200 });
  }
  if (action === 'reencode') {
    video.status = 3;
    if (!video.hold) setTimeout(() => encode(video), ENCODE_MS).unref();
    return json(publicVideo(video));
  }
  if (action === 'play' || action === 'heatmap' || action === 'statistics') return json({});
  switch (request.method) {
    case 'GET':
      return json(publicVideo(video));
    case 'POST': {
      const body = (await request.json().catch(() => ({}))) as { title?: string; collectionId?: string };
      if (body.title !== undefined) video.title = body.title;
      if (body.collectionId !== undefined) video.collectionId = body.collectionId;
      return json({ success: true, message: 'OK', statusCode: 200 });
    }
    case 'PUT':
      uploaded(video, Buffer.from(await request.arrayBuffer()));
      return json({ success: true, message: 'OK', statusCode: 200 });
    case 'DELETE':
      bunny.videos.delete(id);
      return json({ success: true, message: 'OK', statusCode: 200 });
    default:
      return json({ message: 'method not allowed' }, 405);
  }
}

const TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.json': 'application/json',
};

/** The Bunny CDN: /<guid>/<file>. Only encoded videos have media (404 before, like Bunny). */
function cdn(method: string, pathname: string): Response {
  const [guid, ...rest] = pathname.split('/').filter(Boolean);
  const file = rest.join('/');
  const video = bunny.videos.get(guid ?? '');
  const head = method === 'HEAD';
  if (!video || video.status !== 4) return new Response(null, { status: 404 });
  const send = (body: Buffer | string, type: string) => new Response(head ? null : body, { status: 200, headers: { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  if (/^thumbnail(_\d+)?\.jpg$/.test(file) || file === 'preview.webp') return send(readFileSync(THUMBNAIL), 'image/jpeg');
  if (/^(play_\d+p\.mp4|original)$/.test(file)) return send(video.bytes, 'video/mp4');
  const fixture = video.height > video.width ? 'short' : 'bright';
  const name = file === 'playlist.m3u8' ? 'master.m3u8' : file;
  const path = normalize(join(PLAYER_FIXTURES, fixture, name));
  if (!path.startsWith(join(PLAYER_FIXTURES, fixture)) || !existsSync(path)) return new Response(null, { status: 404 });
  return send(readFileSync(path), TYPES[extname(path)] ?? 'application/octet-stream');
}

/** Bunny Storage (PUT/DELETE by the API) and the image host (GET by everyone). */
async function images(request: Request, url: URL): Promise<Response> {
  // Storage: /<zone>/<path>; the image host serves the same file at /<path>
  const path = url.hostname === IMAGE_HOST ? url.pathname : url.pathname.replace(/^\/[^/]+/, '');
  if (request.method === 'PUT') {
    storage.set(path, { body: Buffer.from(await request.arrayBuffer()), type: request.headers.get('content-type') ?? 'application/octet-stream' });
    return json({ HttpCode: 201, Message: 'File uploaded.' }, 201);
  }
  if (request.method === 'DELETE') {
    storage.delete(path);
    return json({ HttpCode: 200, Message: 'File deleted successfully.' });
  }
  const hit = storage.get(path);
  if (!hit) return new Response('not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : hit.body, { status: 200, headers: { 'content-type': hit.type, 'access-control-allow-origin': '*' } });
}

async function resend(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const id = crypto.randomUUID();
  emails.push({ id, ...body });
  return json({ id });
}

/** Registers the fakes with the outbound router. */
export function registerFakes(): void {
  FAKES.set('video.bunnycdn.com', bunnyStream);
  FAKES.set(FAKE_CDN_HOST, (request, url) => cdn(request.method, url.pathname));
  FAKES.set('storage.bunnycdn.com', images);
  FAKES.set('.storage.bunnycdn.com', images);
  FAKES.set(IMAGE_HOST, images);
  FAKES.set('api.resend.com', resend);
}

/** SQL against a stack database by its database_name (boot.ts sets it once Miniflare is up). */
export type StackSql = (database: string, sql: string) => Promise<unknown[]>;
let stackSql: StackSql | undefined;
export function setStackSql(fn: StackSql): void {
  stackSql = fn;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Control API (loopback only):
 * - GET /__fake/bunny/videos[/<guid>], POST /__fake/bunny/videos/<guid>/encode|fail|hold
 * - GET /__fake/resend/emails
 * - POST /__stack/d1/<database name> with SQL as the body: { results } (seed, fast-path fixtures)
 */
async function control(req: IncomingMessage, url: URL): Promise<Response> {
  if (url.pathname.startsWith('/__stack/d1/')) {
    if (req.method !== 'POST' || !stackSql) return json({ error: 'POST SQL once the stack is up' }, 405);
    try {
      return json({ results: await stackSql(decodeURIComponent(url.pathname.slice('/__stack/d1/'.length)), await readBody(req)) });
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  }
  const [, , kind, , guid, action] = url.pathname.split('/');
  if (kind === 'resend') return json(emails);
  if (kind !== 'bunny') return json({ error: 'unknown control path' }, 404);
  if (!guid) return json([...bunny.videos.values()].map(publicVideo));
  const video = bunny.videos.get(guid);
  if (!video) return json({ error: 'no such video' }, 404);
  if (req.method === 'POST' && action === 'encode') encode(video);
  else if (req.method === 'POST' && action === 'fail') Object.assign(video, { status: 5, hold: true });
  else if (req.method === 'POST' && action === 'hold') video.hold = true;
  return json(publicVideo(video));
}

/** The fake CDN + control API for the browser and the tests, on PORTS['fake-cdn']. */
export function startFakeCdn(): Promise<() => Promise<void>> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let response: Response;
    try {
      if (url.pathname.startsWith('/__fake/') || url.pathname.startsWith('/__stack/')) response = await control(req, url);
      // /images/<path> = the image host; anything else = the Bunny CDN
      else if (url.pathname.startsWith('/images/')) response = await images(new Request(`https://${IMAGE_HOST}${url.pathname.slice(7)}`, { method: req.method }), new URL(`https://${IMAGE_HOST}${url.pathname.slice(7)}`));
      else response = cdn(req.method ?? 'GET', url.pathname);
    } catch (error) {
      response = json({ error: (error as Error).message }, 500);
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => {
    server.listen(PORTS['fake-cdn'], '127.0.0.1', () => resolve(() => new Promise((done) => server.close(() => done()))));
  });
}
