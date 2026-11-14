/**
 * The fake Bunny behaves like Bunny where the apps depend on it: TUS offsets survive a resume, a
 * completed upload is processing until encoded, the CDN has no media before the encode, and the
 * encode reports the uploaded MP4's duration and size (the Short rule reads them).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.FAKE_BUNNY_ENCODE = 'manual';
const { bunny, probeMp4, registerFakes, FAKE_CDN_HOST, cdnPath } = await import('../fake-external.ts');
const { outboundHandler, refused } = await import('../outbound.ts');
const { ROOT } = await import('../stack.ts');

const fixture = (name: string) => readFileSync(join(ROOT, 'apps/web/e2e/test-fixtures', name));
const call = (url: string, init?: RequestInit) => outboundHandler(new Request(url, init));

describe('fake Bunny', () => {
  before(() => registerFakes());

  it('reads duration and size from an MP4', () => {
    const landscape = probeMp4(fixture('e2e-sample-40s.mp4'));
    assert.ok(landscape.length >= 39 && landscape.length <= 41, `40 s clip: ${landscape.length}`);
    assert.ok(landscape.width > landscape.height);
    const vertical = probeMp4(fixture('e2e-sample-vertical.mp4'));
    assert.ok(vertical.height > vertical.width, `vertical clip: ${vertical.width}x${vertical.height}`);
  });

  it('create → TUS upload in two chunks with a resume → processing → encode on demand → CDN serves', async () => {
    const created = await (await call('https://video.bunnycdn.com/library/424242/videos', { method: 'POST', body: JSON.stringify({ title: 't' }) })).json() as { guid: string };
    const bytes = fixture('e2e-sample.mp4');
    const post = await call('https://video.bunnycdn.com/tusupload', { method: 'POST', headers: { VideoId: created.guid, 'Upload-Length': String(bytes.length) } });
    assert.equal(post.status, 201);
    const location = `https://video.bunnycdn.com${post.headers.get('Location')}`;
    const half = Math.floor(bytes.length / 2);
    assert.equal((await call(location, { method: 'PATCH', headers: { 'Upload-Offset': '0' }, body: bytes.subarray(0, half) })).headers.get('Upload-Offset'), String(half));
    // A resume asks for the offset; a wrong offset is refused
    assert.equal((await call(location, { method: 'HEAD' })).headers.get('Upload-Offset'), String(half));
    assert.equal((await call(location, { method: 'PATCH', headers: { 'Upload-Offset': '0' }, body: bytes.subarray(0, 10) })).status, 409);
    await call(location, { method: 'PATCH', headers: { 'Upload-Offset': String(half) }, body: bytes.subarray(half) });

    const processing = await (await call(`https://video.bunnycdn.com/library/424242/videos/${created.guid}`)).json() as { status: number };
    assert.equal(processing.status, 2);
    assert.equal((await call(`https://${FAKE_CDN_HOST}/${created.guid}/thumbnail.jpg`, { method: 'HEAD' })).status, 404, 'no thumbnail before the encode');

    const { encode } = await import('../fake-external.ts');
    encode(bunny.videos.get(created.guid)!);
    const ready = await (await call(`https://video.bunnycdn.com/library/424242/videos/${created.guid}`)).json() as { status: number; length: number; width: number };
    assert.equal(ready.status, 4);
    assert.ok(ready.length > 0 && ready.width > 0);
    assert.equal((await call(`https://${FAKE_CDN_HOST}/${created.guid}/thumbnail.jpg`, { method: 'HEAD' })).status, 200);
    const playlist = await (await call(`https://${FAKE_CDN_HOST}/${created.guid}/playlist.m3u8`)).text();
    assert.match(playlist, /^#EXTM3U/);
    assert.equal((await call(`https://${FAKE_CDN_HOST}/${created.guid}/../../stack.ts`)).status, 404, 'no path escape');
  });

  it('reads past Bunny path-form tokens, and answers errors with CORS', async () => {
    assert.deepEqual(cdnPath('/bcdn_token=abc&expires=1&token_path=%2Fg%2F/g/playlist.m3u8'), ['g', 'playlist.m3u8']);
    assert.deepEqual(cdnPath('/g/playlist.m3u8'), ['g', 'playlist.m3u8']);
    const missing = await call(`https://${FAKE_CDN_HOST}/bcdn_token=x&expires=1/nope/playlist.m3u8`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('access-control-allow-origin'), '*');
  });

  it('stores images and serves them from the image host', async () => {
    await call('https://storage.bunnycdn.com/zone/avatars/a.jpg', { method: 'PUT', body: fixture('e2e-thumbnail.jpg') });
    assert.equal((await call('https://images.alummahnow.net/avatars/a.jpg')).status, 200);
    // The API stores "<zone>//<file>" and links "/<file>"
    await call('https://storage.bunnycdn.com/zone//b_avatar.jpeg', { method: 'PUT', body: fixture('e2e-thumbnail.jpg') });
    assert.equal((await call('https://images.alummahnow.net/b_avatar.jpeg')).status, 200);
  });

  it('the browser proxy serves faked HTTPS hosts and refuses everything else', async () => {
    const { startBrowserProxy } = await import('../browser-proxy.ts');
    const { PORTS } = await import('../stack.ts');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const stop = await startBrowserProxy();
    try {
      // Async: the proxy answers on this same event loop
      const curl = async (target: string) =>
        (await promisify(execFile)('curl', ['-sk', '-m', '10', '-o', '/dev/null', '-w', '%{http_code}', '-x', `http://127.0.0.1:${PORTS['browser-proxy']}`, target]).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))).stdout;
      assert.equal(await curl('https://images.alummahnow.net/avatars/a.jpg'), '200');
      assert.notEqual(await curl('https://videos.qa.alummahnow.net/'), '200');
    } finally {
      await stop();
    }
  });

  it('refuses hosts without a fake', async () => {
    const res = await call('https://videos.api.qa.alummahnow.net/api/videos');
    assert.equal(res.status, 502);
    assert.ok(refused.includes('GET https://videos.api.qa.alummahnow.net/api/videos'));
  });
});

describe('fake media pipeline (R2 transcode + media host)', () => {
  before(() => registerFakes());
  const VID = '912859ed-e618-4d04-8438-874a74a251dd';
  const REV = 'abcdefgh12345678';

  it('sends started then ready for the queued job, then the media host serves that rendition only', async () => {
    const { fakeTranscode, setStackR2, FAKE_MEDIA_HOST, fakeMedia } = await import('../fake-external.ts');
    setStackR2(async (bucket, key, method) => {
      if (bucket === 'videos' && key === VID && method === 'GET') return { status: 200, body: JSON.stringify({ id: VID, r2: { jobId: 'job-1', rev: REV, access: 'pub', status: 'queued' } }) };
      if (bucket === 'al-ummah-now-media-originals' && method === 'LIST') return { status: 200, body: JSON.stringify({ keys: [`src/${VID}/u1/0`] }) };
      return { status: 404 };
    });
    const events: Array<{ url: string; key: string | null; body: { type: string; jobId: string; result?: unknown } }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      events.push({ url: String(url), key: new Headers(init?.headers).get('X-API-Key'), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      // Before the transcode: nothing to serve
      assert.equal((await call(`https://${FAKE_MEDIA_HOST}/pub/${VID}/${REV}/master.m3u8`)).status, 404);
      const res = await fakeTranscode(VID, 'ready');
      assert.equal(res.status, 200);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(events.map((e) => [e.body.type, e.body.jobId]), [['started', 'job-1'], ['ready', 'job-1']]);
    assert.ok(events.every((e) => e.url.endsWith('/internal/media/events') && e.key === 'local-stack-internal-key'));
    const master = await call(`https://${FAKE_MEDIA_HOST}/pub/${VID}/${REV}/master.m3u8`);
    assert.equal(master.status, 200);
    assert.match(await master.text(), /#EXTM3U/);
    assert.equal((await call(`https://${FAKE_MEDIA_HOST}/pub/${VID}/${REV}/thumb.jpg`)).headers.get('content-type'), 'image/jpeg');
    // Another rev, or the private path of a public rendition: not served
    assert.equal((await call(`https://${FAKE_MEDIA_HOST}/pub/${VID}/zzzzzzzzzzzzzzzz/master.m3u8`)).status, 404);
    assert.equal((await call(`https://${FAKE_MEDIA_HOST}/priv/1800000000.${'a'.repeat(32)}/${VID}/${REV}/master.m3u8`)).status, 404);
    assert.equal((await call(`https://${FAKE_MEDIA_HOST}/priv/nope/${VID}/${REV}/master.m3u8`)).status, 403);
    // Down (fallback specs): 503 for everything
    fakeMedia.down = true;
    assert.equal((await call(`https://${FAKE_MEDIA_HOST}/pub/${VID}/${REV}/master.m3u8`)).status, 503);
    fakeMedia.down = false;
  });

  it('refuses a video with no queued transcode or no kept original', async () => {
    const { fakeTranscode, setStackR2 } = await import('../fake-external.ts');
    setStackR2(async (bucket, _key, method) => {
      if (bucket === 'videos' && method === 'GET') return { status: 200, body: JSON.stringify({ id: VID }) };
      return { status: 200, body: JSON.stringify({ keys: [] }) };
    });
    assert.equal((await fakeTranscode(VID, 'ready')).status, 409);
  });
});
