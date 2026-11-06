import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { SeedVideo } from './seed-config';
import { seedLogger as log } from './seed-logger';

/**
 * Generates small, real MP4 files (H.264 + AAC) with ffmpeg: a moving test
 * pattern, a sine tone and, when the drawtext filter is available, the video
 * title burned in. Files are cached by slug so re-runs reuse them.
 */

const FONT_CANDIDATES = [
  process.env.SEED_FONT_FILE,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
].filter((p): p is string => Boolean(p));

let drawtextSupport: boolean | undefined;

function ffmpegHasDrawtext(ffmpeg: string): boolean {
  if (drawtextSupport !== undefined) return drawtextSupport;
  try {
    const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    drawtextSupport = /\bdrawtext\b/.test(filters);
  } catch {
    drawtextSupport = false;
  }
  if (!drawtextSupport) {
    log.warn('ffmpeg has no drawtext filter (built without libfreetype); generated videos will not show the title text');
  }
  return drawtextSupport;
}

/** Escapes text for use inside a drawtext text='...' option */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "’")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,');
}

export function generateVideo(video: SeedVideo, outDir: string): string {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${video.slug}.mp4`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    log.info('Reusing generated media', { slug: video.slug, bytes: fs.statSync(outFile).size });
    return outFile;
  }

  const size = video.orientation === 'portrait' ? '360x640' : '640x360';
  const fontFile = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  const filters: string[] = [];
  if (fontFile && ffmpegHasDrawtext(ffmpeg)) {
    const fontSize = video.orientation === 'portrait' ? 18 : 24;
    filters.push(
      `drawtext=fontfile='${fontFile}':text='${escapeDrawtext(video.title)}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=h*0.12`,
      `drawtext=fontfile='${fontFile}':text='Al Ummah Now QA seed':fontcolor=white:fontsize=${fontSize - 6}:box=1:boxcolor=black@0.6:boxborderw=6:x=(w-text_w)/2:y=h*0.80`,
      `drawtext=fontfile='${fontFile}':text='%{pts\\:hms}':fontcolor=yellow:fontsize=${fontSize - 4}:x=10:y=10`,
    );
  }

  const buildArgs = (withOverlay: boolean) => [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${video.durationSeconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${video.toneHz}:sample_rate=44100:duration=${video.durationSeconds}`,
    ...(withOverlay && filters.length > 0 ? ['-vf', filters.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  ];

  log.info('Generating media with ffmpeg', { slug: video.slug, size, durationSeconds: video.durationSeconds, titleOverlay: filters.length > 0 });
  try {
    execFileSync(ffmpeg, buildArgs(true), { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (error) {
    if (filters.length === 0) throw error;
    log.warn('ffmpeg failed with the title overlay; regenerating without it', { slug: video.slug });
    execFileSync(ffmpeg, buildArgs(false), { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  const bytes = fs.statSync(outFile).size;
  log.info('Generated media', { slug: video.slug, bytes });
  return outFile;
}
