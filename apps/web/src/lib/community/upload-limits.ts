/**
 * Community post upload limits in the composer. The limits come from @al-ummah/shared-types (the same
 * values the API enforces); every check takes a `limits` argument so they can later be read from
 * settings. Messages name the file, its size and the limit, sized in the UI language.
 */
import { COMMUNITY_UPLOAD_LIMITS, communityUploadLimit, type CommunityUploadKind, type CommunityUploadLimits, formatUnit } from '@al-ummah/shared-types';

const MB = 1024 * 1024;

/** The file the API or the composer refused for its size. */
export interface TooLargeFile {
  fileName: string;
  size: number;
  maxBytes: number;
}

interface TooLargeStrings {
  community: { imageTooLarge: string; gifTooLarge: string };
}

/** A byte count as "12.4 MB" / "12.4 ميغابايت" (kilobytes under 1 MB). */
export function formatUploadSize(bytes: number, lang: string): string {
  const ar = lang === 'ar';
  const unit = bytes < MB ? 'kilobyte' : 'megabyte';
  const value = bytes < MB ? bytes / 1024 : bytes / MB;
  return formatUnit(lang, value, unit, { unitDisplay: ar ? 'long' : 'short' });
}

/** "photo.jpg is 12.4 MB. Images can be up to 5 MB." in the UI language. */
export function tooLargeMessage(t: TooLargeStrings, lang: string, kind: CommunityUploadKind, file: TooLargeFile): string {
  const template = kind === 'gif' ? t.community.gifTooLarge : t.community.imageTooLarge;
  const values: Record<string, string> = {
    name: file.fileName,
    size: formatUploadSize(file.size, lang),
    limit: formatUploadSize(file.maxBytes, lang),
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}

/** The file when it is over its kind's limit, else null. */
export function overLimit(
  file: { name: string; size: number },
  kind: CommunityUploadKind,
  limits: CommunityUploadLimits = COMMUNITY_UPLOAD_LIMITS,
): TooLargeFile | null {
  const maxBytes = communityUploadLimit(kind, limits);
  return file.size > maxBytes ? { fileName: file.name, size: file.size, maxBytes } : null;
}
