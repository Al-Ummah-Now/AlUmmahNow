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
const { bunny, probeMp4, registerFakes, FAKE_CDN_HOST } = await import('../fake-external.ts');
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
