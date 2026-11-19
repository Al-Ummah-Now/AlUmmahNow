/**
 * The fake YouTube's thumbnail host serves the fixture channel's own art: each video's title card
 * (1280×720, the shape the import checks) and the channel avatar, never the E2E colour-bar image
 * that review shots would show as test data.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { ytimg, FIXTURE_VIDEOS, FIXTURE_CHANNEL } = await import('../fake-google.ts');
const { ROOT } = await import('../stack.ts');

const art = (name: string) => readFileSync(join(ROOT, 'apps/web/e2e/test-fixtures/youtube-thumbnails', name));
const fixtureImage = readFileSync(join(ROOT, 'apps/web/e2e/test-fixtures/e2e-thumbnail.jpg'));
const get = async (path: string) => {
  const url = new URL(`https://i.ytimg.com${path}`);
  const res = ytimg(new Request(url), url);
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};
/** JPEG width × height from the first SOF marker. */
function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return [0, 0];
}

describe('fake YouTube thumbnails', () => {
  it('every fixture video has a custom thumbnail: its own 1280×720 title card at every size', async () => {
    for (const video of FIXTURE_VIDEOS) {
      assert.equal(video.thumbnail, true, video.id);
      for (const size of ['default', 'hqdefault', 'maxresdefault']) {
        const res = await get(`/vi/${video.id}/${size}.jpg`);
        assert.equal(res.status, 200);
        assert.equal(res.type, 'image/jpeg');
        assert.ok(res.body.equals(art(`${video.id}.jpg`)), `${video.id} ${size}`);
        assert.ok(!res.body.equals(fixtureImage));
      }
      assert.deepEqual(jpegSize(art(`${video.id}.jpg`)), [1280, 720]);
    }
  });

  it('the channel has its avatar; an unknown video gets the E2E image; other paths 404', async () => {
    assert.ok((await get(`/ch/${FIXTURE_CHANNEL.id}/default.jpg`)).body.equals(art('channel.jpg')));
    assert.ok((await get('/vi/unknownId01/default.jpg')).body.equals(fixtureImage));
    assert.equal((await get('/favicon.ico')).status, 404);
  });
});
