/**
 * Class names the playlist tools share. Colours come from Fanous tokens only
 * (theme/system.css components and --fanous-* variables), so every theme and
 * mode styles them.
 */

export const TEXT = 'text-[var(--fanous-color-text-primary)]';
export const MUTED = 'text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]';
export const FAINT = 'text-[var(--fanous-color-text-muted)]';
export const FIELD = 'f-input w-full px-3 py-2 text-sm';
export const LABEL = 'block mb-1 text-sm font-semibold text-[var(--fanous-c-form-label)]';
export const DIVIDE = 'divide-y divide-[var(--fanous-color-divider)]';
export const BORDER = 'border border-[var(--fanous-color-divider)]';

/** Tinted notice surfaces (status colours are shared meanings, exempt from the logo hues). */
export const NOTICE = {
  error: 'bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]',
  success: 'bg-[color-mix(in_srgb,var(--fanous-color-verified-fill)_16%,var(--fanous-color-surface))] text-[var(--fanous-color-success-text)]',
  info: 'bg-[color-mix(in_srgb,var(--fanous-color-primary)_12%,var(--fanous-color-surface))] text-[var(--fanous-color-text-primary)]',
} as const;

/** The focus ring for custom controls (visually hidden inputs drive a styled box). */
export const FOCUS_RING = 'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--fanous-color-focus-ring)]';
