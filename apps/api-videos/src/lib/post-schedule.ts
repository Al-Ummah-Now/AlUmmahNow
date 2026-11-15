/**
 * When a community post may be scheduled for (Story 29.4): the window scheduled videos use
 * (lib/videoSchedule.ts), 5 minutes to a year ahead, so the every-minute cron (every 5 on QA and
 * stage, lib/scheduled-posts.ts) always has a marker to find.
 */
import { scheduleDateProblem } from './videoSchedule';

export type PostScheduleCode = 'schedule_invalid' | 'schedule_too_soon' | 'schedule_too_far';

export function postScheduleProblem(scheduledAt: unknown, now = new Date()): { code: PostScheduleCode; message: string } | null {
	const date = typeof scheduledAt === 'string' ? new Date(scheduledAt) : new Date(Number.NaN);
	switch (scheduleDateProblem(date, now)) {
		case 'invalid':
			return { code: 'schedule_invalid', message: 'scheduledAt is not a valid date' };
		case 'too_soon':
			return { code: 'schedule_too_soon', message: 'A post must be scheduled at least 5 minutes ahead' };
		case 'too_far':
			return { code: 'schedule_too_far', message: 'A post can be scheduled at most a year ahead' };
		default:
			return null;
	}
}
