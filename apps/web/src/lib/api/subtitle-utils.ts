/**
 * Subtitle Utility Functions
 *
 * Non-server action utilities for subtitle handling.
 * These are pure functions that can be used in client components.
 */

/**
 * Format time for display
 * Converts "HH:MM:SS,mmm" to "HH:MM:SS"
 */
export function formatSubtitleTime(timeStr: string): string {
  return timeStr.substring(0, 8); // HH:MM:SS
}

/**
 * Parse SRT time format to seconds
 * Converts "HH:MM:SS,mmm" to number of seconds
 */
export function parseSubtitleTime(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2].replace(',', '.'));
  return hours * 3600 + minutes * 60 + seconds;
}
