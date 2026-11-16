/**
 * Player defaults (#87 item 8).
 */
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../videojs-setup.ts'), 'utf8');

describe('VIDEO_JS_OPTIONS', () => {
  it('keeps the controls visible for 4 seconds after the last activity', () => {
    expect(source).toMatch(/inactivityTimeout: 4000/);
  });
});

describe('Arabic player text', () => {
  it('overrides every Video.js Arabic string that says «فيديو» with the site word «مرئي»', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pack = require('video.js/dist/lang/ar.json') as Record<string, string>;
    const arBlock = source.slice(source.indexOf('ar: {'));
    const keys = Object.keys(pack).filter((key) => pack[key].includes('فيديو'));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const line = arBlock.split('\n').find((l) => l.includes(`'${key}':`));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/فيديو/);
      expect(line).toMatch(/مرئي/);
    }
  });
});
