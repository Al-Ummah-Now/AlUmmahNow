/** Shared mocks for the playlist tool tests. */
export const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;

export function video(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Lesson ${id}`, thumbnailUrl: `https://img.test/${id}.jpg`, duration: 90, isPublic: true, uploadStatus: 'ready', dateCreated: '2026-11-01T00:00:00.000Z', ...extra };
}
