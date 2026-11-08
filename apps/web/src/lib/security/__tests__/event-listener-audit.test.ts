/**
 * Story 1.2 AC 1, 4 regression guard (static audit).
 *
 * Every global (window/document) listener registered by the video player and
 * its helpers must (a) use an allowlisted event type and (b) be removed again
 * (removeEventListener with the same type, or an AbortSignal), so listeners are
 * scoped to the player's lifetime. New code that violates this fails here.
 */
import fs from 'fs';
import path from 'path';
import { GLOBAL_EVENT_ALLOWLIST } from '../allowlist';

const ROOT = path.resolve(__dirname, '../../..');
const AUDITED_DIRS = ['components/VideoPlayer', 'components/video', 'lib/video', 'services/analytics', 'services/monitoring', 'hooks'];

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

const GLOBAL_ADD = /\b(window|document)\.addEventListener\(\s*['"]([^'"]+)['"]/g;

interface Registration {
  file: string;
  target: string;
  type: string;
}

function registrationsIn(dirs: string[]): Registration[] {
  return dirs.flatMap(sourceFiles).flatMap(file => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return Array.from(source.matchAll(GLOBAL_ADD), m => ({ file, target: m[1], type: m[2] }));
  });
}

/** Video player and its helpers: must be allowlisted AND cleaned up. */
const registrations = registrationsIn(AUDITED_DIRS);
/** Whole app: the validator enforces site-wide, so every global listener type must be allowlisted. */
const appRegistrations = registrationsIn(['app', 'components', 'contexts', 'hooks', 'lib', 'providers', 'services']);

describe('global event listener audit', () => {
  it('finds the video player global listeners (sanity check)', () => {
    expect(registrations.some(r => r.file.includes('keyboard-shortcuts'))).toBe(true);
    expect(appRegistrations.length).toBeGreaterThan(registrations.length);
  });

  it.each(appRegistrations.map(r => [`${r.target}:${r.type} in ${r.file}`, r] as const))('%s is allowlisted', (_label, r) => {
    expect(GLOBAL_EVENT_ALLOWLIST.has(r.type)).toBe(true);
  });

  it('allowlists every custom event the app dispatches on window/document', () => {
    const dispatched = ['app', 'components', 'contexts', 'hooks', 'lib', 'providers', 'services']
      .flatMap(sourceFiles)
      .flatMap(file => Array.from(fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/new CustomEvent\(\s*['"]([^'"]+)['"]/g), m => m[1]));
    for (const type of dispatched) expect(GLOBAL_EVENT_ALLOWLIST.has(type)).toBe(true);
  });

  it.each(registrations.map(r => [`${r.target}:${r.type} in ${r.file}`, r] as const))('%s is removed on cleanup', (_label, r) => {
    const source = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
    const removed = new RegExp(`${r.target}\\.removeEventListener\\(\\s*['"]${r.type}['"]`).test(source);
    const aborted = /signal\s*[:,}]/.test(source);
    expect(removed || aborted).toBe(true);
  });
});
