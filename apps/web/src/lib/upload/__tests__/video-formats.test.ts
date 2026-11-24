/**
 * Which files the upload forms accept (#1938). A browser names a file's type from the operating
 * system: MOV is video/quicktime, AVI is video/x-msvideo, MKV is video/x-matroska, and a system
 * without the association gives an empty type. The check used to compare the type with
 * video/mov and video/avi, which no browser sends, so every iPhone video was refused.
 */
import { AR_TRANSLATIONS, EN_TRANSLATIONS, fillTemplate } from '@al-ummah/shared-types';
import {
  VIDEO_FORMATS,
  VIDEO_PICKER_ACCEPT,
  isAcceptedVideoFile,
  videoFormatOf,
  videoFormatsText,
  videoMimeTypeOf,
} from '../video-formats';
import { VIDEO_UPLOAD_CONFIG } from '@/lib/constants/uploadConfig';

const file = (name: string, type: string) => new File(['x'], name, { type });

// What Chrome, Safari and Firefox really report for each extension, by operating system
const REAL: Array<{ name: string; type: string; sent: string }> = [
  { name: 'clip.mp4', type: 'video/mp4', sent: 'video/mp4' },
  { name: 'clip.m4v', type: 'video/x-m4v', sent: 'video/x-m4v' },
  // A browser that names an M4V video/mp4 is believed: the type wins over the extension
  { name: 'clip.m4v', type: 'video/mp4', sent: 'video/mp4' },
  { name: 'IMG_0001.MOV', type: 'video/quicktime', sent: 'video/quicktime' },
  { name: 'clip.mov', type: 'video/quicktime', sent: 'video/quicktime' },
  { name: 'clip.webm', type: 'video/webm', sent: 'video/webm' },
  { name: 'clip.mkv', type: 'video/x-matroska', sent: 'video/x-matroska' },
  { name: 'clip.avi', type: 'video/x-msvideo', sent: 'video/x-msvideo' },
  { name: 'clip.avi', type: 'video/avi', sent: 'video/x-msvideo' },
  { name: 'clip.avi', type: 'video/vnd.avi', sent: 'video/x-msvideo' },
];

describe('video file check', () => {
  it.each(REAL)('accepts $name reported as "$type" and sends $sent', ({ name, type, sent }) => {
    expect(isAcceptedVideoFile(file(name, type))).toBe(true);
    expect(videoMimeTypeOf(file(name, type))).toBe(sent);
  });

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['clip.m4v', 'video/x-m4v'],
    ['clip.mov', 'video/quicktime'],
    ['clip.webm', 'video/webm'],
    ['clip.mkv', 'video/x-matroska'],
    ['clip.avi', 'video/x-msvideo'],
  ])('accepts %s with no type (some systems give none) by its extension and sends %s', (name, sent) => {
    expect(isAcceptedVideoFile(file(name, ''))).toBe(true);
    expect(videoMimeTypeOf(file(name, ''))).toBe(sent);
    // A generic type says as little as none
    expect(isAcceptedVideoFile(file(name, 'application/octet-stream'))).toBe(true);
    expect(videoMimeTypeOf(file(name, 'application/octet-stream'))).toBe(sent);
  });

  it('reads the extension in any case and ignores dots in the name', () => {
    expect(isAcceptedVideoFile(file('Khutbah.MOV', ''))).toBe(true);
    expect(isAcceptedVideoFile(file('Khutbah.WebM', ''))).toBe(true);
    expect(videoFormatOf(file('part 1. final.cut.MKV', ''))?.label).toBe('MKV');
  });

  it('ignores a type\'s parameters', () => {
    expect(isAcceptedVideoFile(file('clip.webm', 'video/webm; codecs=vp9'))).toBe(true);
  });

  it('refuses an empty type with an extension that is not on the list', () => {
    for (const name of ['notes.txt', 'clip.wmv', 'clip.flv', 'clip', 'clip.', '.mp4x', 'mp4']) {
      expect(isAcceptedVideoFile(file(name, ''))).toBe(false);
    }
  });

  it('refuses a type that names another kind of file, whatever the extension says', () => {
    for (const [name, type] of [
      ['clip.mp4', 'text/plain'],
      ['clip.mov', 'application/pdf'],
      ['clip.webm', 'image/png'],
      ['clip.mp4', 'audio/mp4'],
      ['clip.mp4', 'video/x-ms-wmv'],
      ['clip.mp4', 'video/mp2t'],
    ] as const) {
      expect(isAcceptedVideoFile(file(name, type))).toBe(false);
    }
  });

  it('accepts a video type on the list whatever the file is called', () => {
    expect(isAcceptedVideoFile(file('video', 'video/quicktime'))).toBe(true);
    expect(isAcceptedVideoFile(file('IMG_0001.HEIC', 'video/quicktime'))).toBe(true);
  });

  it('sends a refused file\'s own type unchanged', () => {
    expect(videoMimeTypeOf(file('a.txt', 'text/plain'))).toBe('text/plain');
  });

  it('names the same formats in the config, the picker and the help text', () => {
    const labels = VIDEO_FORMATS.map((f) => f.label);
    expect(labels).toEqual(['MP4', 'M4V', 'MOV', 'WebM', 'MKV', 'AVI']);
    expect(VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES).toEqual(VIDEO_FORMATS.map((f) => f.mimeType));
    expect(videoFormatsText('en')).toBe('MP4, M4V, MOV, WebM, MKV, AVI');
    expect(videoFormatsText('ar')).toBe('MP4، M4V، MOV، WebM، MKV، AVI');
    expect(VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY).toBe(videoFormatsText('en'));
  });

  it('lists every extension and every type in the picker, so a file with no type still shows', () => {
    const accept = VIDEO_PICKER_ACCEPT.split(',');
    for (const ext of ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi']) expect(accept).toContain(ext);
    for (const type of ['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo']) expect(accept).toContain(type);
    // Not "video/*": that would show files the form refuses
    expect(accept).not.toContain('video/*');
  });
});

describe('upload copy', () => {
  const formats = (lang: 'en' | 'ar') => videoFormatsText(lang);

  it('fills the supported formats into the guidelines, the batch limit and both errors, in English and Arabic', () => {
    for (const [lang, t] of [['en', EN_TRANSLATIONS], ['ar', AR_TRANSLATIONS]] as const) {
      for (const text of [t.upload.guidelineFormats, t.batch.fileLimit, t.batch.errors.invalidFileType, t.upload.invalidType]) {
        expect(text).toContain('{formats}');
        expect(fillTemplate(lang, text, { formats: formats(lang), filename: 'a.txt' })).toContain(formats(lang));
      }
    }
  });

  it('keeps no format list in the translated strings: one list, in video-formats.ts', () => {
    for (const t of [EN_TRANSLATIONS, AR_TRANSLATIONS]) {
      for (const text of [t.upload.guidelineFormats, t.batch.fileLimit, t.batch.errors.invalidFileType]) {
        expect(text).not.toMatch(/\b(MP4|MOV|AVI|WebM|MKV)\b/);
      }
    }
  });

  it('writes the Arabic copy with «مرئي», never «فيديو»', () => {
    for (const text of [AR_TRANSLATIONS.upload.guidelineFormats, AR_TRANSLATIONS.batch.fileLimit, AR_TRANSLATIONS.batch.errors.invalidFileType, AR_TRANSLATIONS.upload.invalidType]) {
      expect(text).not.toMatch(/فيديو/);
    }
    expect(AR_TRANSLATIONS.batch.fileLimit).toContain('مرئي');
  });
});
