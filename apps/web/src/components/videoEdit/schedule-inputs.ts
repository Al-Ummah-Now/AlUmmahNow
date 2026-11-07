/**
 * Values for <input type="date"> / <input type="time">, which are always in the
 * viewer's local time zone. Date#toISOString() is UTC, so pairing it with a
 * local time shifted the day for anyone not on UTC.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time */
export function toLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * GET /api/videos/:id/schedule answers 200 for every video; only a response
 * with a publish date (and not explicitly `isScheduled: false`) is a schedule.
 */
export function isActiveSchedule(result: { isScheduled?: boolean; scheduledPublishDate?: string | null }): boolean {
  return (
    result.isScheduled !== false &&
    !!result.scheduledPublishDate &&
    !Number.isNaN(new Date(result.scheduledPublishDate).getTime())
  );
}

/** HH:MM (24h) in local time */
export function toLocalTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
