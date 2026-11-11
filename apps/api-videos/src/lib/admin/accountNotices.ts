/**
 * Account notices for admin-api (warn-user feature).
 *
 * - accountNotice: the in-app notice of a moderator's warning, through the
 *   notification pipeline (queue → processor stores it, pushes it in real time
 *   and to devices). Category account is always on, so it always arrives.
 * - accountEmailContact: what admin-api needs to email the user about their
 *   account: address, name, "Email me about my account" and the language.
 */
import {
	DEFAULT_NOTIFICATION_EMAIL_LOCALE,
	REPORT_REASONS,
	type AccountEmailContact,
	type AccountNoticeRequest,
	type AccountNoticeResult,
} from '@al-ummah/shared-types';
import { z } from 'zod';
import R2Repository from '../r2Repo';
import { accountNoticePayload, enqueueNotification, getEmailSettings, type NotificationsEnv } from '../notifications';
import { logger } from '../logger';
import { AdminError } from './service';
import { toUserRow, type AdminEnv } from './directory';

export const AccountNoticeBody = z.object({
	kind: z.literal('warning'),
	noticeId: z.string().trim().min(1).max(200),
	reasonCode: z.enum(REPORT_REASONS),
	count: z.number().int().min(1).max(100000),
});

type Env = AdminEnv & NotificationsEnv;

async function readProfile(env: Env, userId: string): Promise<Record<string, unknown>> {
	const profile = await new R2Repository<Record<string, unknown>>(env.profiles).getObject(userId);
	if (!profile) throw new AdminError(404, 'user_not_found');
	return profile;
}

/** Queues the in-app notice. 404 when the user has no videos profile. */
export async function accountNotice(env: Env, userId: string, notice: AccountNoticeRequest): Promise<AccountNoticeResult> {
	await readProfile(env, userId);
	const queued = await enqueueNotification(env, accountNoticePayload(userId, notice));
	if (!queued) logger.warn('[AccountNotice] In-app notice not queued', { userId, noticeId: notice.noticeId });
	else logger.debug('[AccountNotice] In-app notice queued', { userId, noticeId: notice.noticeId, kind: notice.kind });
	return { queued };
}

/** The user's email address, name and email preferences. */
export async function accountEmailContact(env: Env, userId: string): Promise<AccountEmailContact> {
	const profile = await readProfile(env, userId);
	const row = toUserRow(userId, profile, false);
	const prefs = env.NOTIFICATIONS_DB ? await getEmailSettings(env.NOTIFICATIONS_DB, userId) : null;
	return {
		userId,
		email: row.email,
		displayName: row.displayName,
		accountEmail: prefs?.account ?? true,
		locale: prefs?.locale ?? DEFAULT_NOTIFICATION_EMAIL_LOCALE,
	};
}
