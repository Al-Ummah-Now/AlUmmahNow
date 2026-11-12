/**
 * Video reactions contract (owner decision 2026-11-11).
 *
 * Dislikes are hidden and no longer accepted. POST /api/videos/{id}/dislikes
 * answers 410 Gone with `code: "dislikes_disabled"`; like, unlike and
 * DELETE /api/videos/{id}/dislikes (clear an old dislike) still work, and
 * liking clears the member's old dislike. Public video payloads keep
 * `dislikesCount` for older clients, always 0.
 */
export const DISLIKES_DISABLED_CODE = 'dislikes_disabled' as const;

export const DISLIKES_DISABLED_MESSAGE = {
  en: 'Dislikes are turned off',
  ar: 'تم إيقاف عدم الإعجاب',
} as const;
