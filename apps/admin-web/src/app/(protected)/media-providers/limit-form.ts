/**
 * The concurrent transcodes range fields (R2Settings.tsx): what the typed values mean. Pure, so it is
 * unit tested; admin-api and api-videos check the same rules again (1 ≤ min ≤ max ≤ ceiling).
 */
import { parseDigits, TRANSCODE_LIMIT_FLOOR, type TranscodeRange } from '@al-ummah/shared-types';

/** The Cloudflare R2 settings section's anchor (R2Settings.tsx); Delivery's live figure links to it. */
export const R2_SETTINGS_ID = 'r2-settings';

export type RangeInputError = 'min_range' | 'max_range' | 'min_above_max' | 'unchanged';
export type RangeInput = { ok: true; value: TranscodeRange } | { ok: false; error: RangeInputError; field: 'min' | 'max' | null };

function whole(text: string, ceiling: number | null): number | null {
  // Eastern Arabic (Hindi) and Persian numerals typed on an Arabic keyboard read as their numbers
  const trimmed = parseDigits(text.trim());
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value < TRANSCODE_LIMIT_FLOOR || (ceiling !== null && value > ceiling) ? null : value;
}

export function checkRangeInput(minText: string, maxText: string, ceiling: number | null, current: TranscodeRange): RangeInput {
  const min = whole(minText, ceiling);
  if (min === null) return { ok: false, error: 'min_range', field: 'min' };
  const max = whole(maxText, ceiling);
  if (max === null) return { ok: false, error: 'max_range', field: 'max' };
  if (min > max) return { ok: false, error: 'min_above_max', field: 'min' };
  if (min === current.min && max === current.max) return { ok: false, error: 'unchanged', field: null };
  return { ok: true, value: { min, max } };
}
