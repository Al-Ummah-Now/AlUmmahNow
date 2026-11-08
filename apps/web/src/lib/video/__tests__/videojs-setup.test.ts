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
