/**
 * Media control icons (play, pause, skip, seek) keep their direction in Arabic: they describe
 * the media's timeline, not the reading direction, so they are never mirrored for RTL.
 * (2026-11-12: the playlist page's "Play all" ▶ was rotated to point left in Arabic.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const MEDIA_ICON = /<(Play|PlayCircle|Pause|PauseCircle|SkipForward|SkipBack|FastForward|Rewind|StepForward|StepBack)\b[^>]*>/g;
const MIRRORED = /rotate-180|scale-x-\[-1\]|-scale-x-100|rtl:/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

describe('media icons in RTL', () => {
  it('are never rotated or mirrored', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(MEDIA_ICON)) {
        if (MIRRORED.test(m[0])) offenders.push(`${file.slice(SRC.length + 1)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
