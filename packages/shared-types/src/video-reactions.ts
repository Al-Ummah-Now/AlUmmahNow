/**
 * Reactions contract (owner decisions 2026-11-11 for videos, 2026-11-12 for
 * comments).
 *
 * Dislikes are hidden and no longer accepted. POST /api/videos/{id}/dislikes
 * and POST /api/videos/{id}/comments/{cid}/dislikes answer 410 Gone with
 * `code: "dislikes_disabled"`; like, unlike and the DELETE dislike routes
 * (clear an old dislike) still work, and liking clears the member's old
 * dislike. Public payloads keep `dislikesCount` for older clients, always 0.
 */
export const DISLIKES_DISABLED_CODE = 'dislikes_disabled' as const;

export const DISLIKES_DISABLED_MESSAGE = {
  en: 'Dislikes are turned off',
  ar: 'تم إيقاف عدم الإعجاب',
} as const;
