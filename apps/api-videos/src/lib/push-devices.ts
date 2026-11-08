/**
 * Push device registry (Epic 9.4), in NOTIFICATIONS_DB.push_devices.
 *
 * Ownership rules:
 * - an install belongs to one user; the same install signing in as someone
 *   else may take the row over only by presenting the same push token
 *   (possession of the token proves it is the same physical device), so a
 *   guessed install id can't redirect another user's notifications;
 * - a push token belongs to one install: registering it under a new install
 *   id (reinstall) removes the old row;
 * - at most MAX_DEVICES_PER_USER rows per user; the least recently updated go first.
 */
import { z } from 'zod';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@al-ummah/shared-types';

export const MAX_DEVICES_PER_USER = 20;
export const PUSH_PROVIDERS = ['apns', 'fcm', 'wns', 'webpush'] as const;
export const PUSH_PLATFORMS = ['ios', 'ipados', 'tvos', 'macos', 'android', 'androidtv', 'windows', 'web'] as const;
export type PushProvider = (typeof PUSH_PROVIDERS)[number];
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Which providers a platform may register with. */
export const PLATFORM_PROVIDERS: Record<PushPlatform, readonly PushProvider[]> = {
	ios: ['apns', 'fcm'],
	ipados: ['apns', 'fcm'],
	tvos: ['apns'],
	macos: ['apns', 'webpush'],
	android: ['fcm'],
	androidtv: ['fcm'],
	windows: ['wns', 'webpush'],
	web: ['webpush'],
};

export const InstallIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'installId must be 8-64 of [A-Za-z0-9_-]');

/**
 * The push fan-out POSTs to these URLs, so only the real push services are
 * accepted (no arbitrary hosts, IP literals or explicit ports: no SSRF).
 */
const httpsUrl = (hostOk: (host: string) => boolean) =>
	z
		.string()
		.max(2048)
		.refine((v) => {
			try {
				const u = new URL(v);
				return u.protocol === 'https:' && u.port === '' && !u.username && !u.password && hostOk(u.hostname);
			} catch {
				return false;
			}
		}, 'must be an https URL of the push service');

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Browser push services: Chrome/Opera/Samsung (FCM), Firefox (Mozilla autopush), Safari (Apple), Edge (WNS). */
export function isWebPushHost(host: string): boolean {
	return (
		host === 'fcm.googleapis.com' ||
		hostIs(host, 'push.services.mozilla.com') ||
		hostIs(host, 'push.apple.com') ||
		hostIs(host, 'notify.windows.com')
	);
}

export const WebPushSubscriptionSchema = z.object({
	endpoint: httpsUrl(isWebPushHost),
	expirationTime: z.number().nullable().optional(),
	keys: z.object({
		p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/),
		auth: z.string().regex(/^[A-Za-z0-9_-]{16,24}={0,2}$/),
	}),
});

/** Provider-specific token formats. */
const TOKEN_FORMATS: Record<Exclude<PushProvider, 'webpush'>, z.ZodType<string>> = {
	apns: z.string().regex(/^[0-9a-fA-F]{64,200}$/, 'APNs token must be hex'),
	fcm: z.string().regex(/^[A-Za-z0-9_:-]{32,4096}$/, 'not an FCM registration token'),
	wns: httpsUrl((h) => hostIs(h, 'notify.windows.com')),
};

export const DeviceRegistrationSchema = z
	.object({
		platform: z.enum(PUSH_PLATFORMS),
		provider: z.enum(PUSH_PROVIDERS),
		token: z.string().optional(),
		subscription: WebPushSubscriptionSchema.optional(),
		locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).optional(),
		appVersion: z.string().max(32).optional(),
		categories: z.array(z.enum(NOTIFICATION_CATEGORIES as unknown as [NotificationCategory, ...NotificationCategory[]])).max(NOTIFICATION_CATEGORIES.length).optional(),
	})
	.superRefine((v, ctx) => {
		if (!PLATFORM_PROVIDERS[v.platform].includes(v.provider)) {
			ctx.addIssue({ code: 'custom', path: ['provider'], message: `${v.provider} is not available on ${v.platform}` });
		}
		if (v.provider === 'webpush') {
			if (!v.subscription || v.token) ctx.addIssue({ code: 'custom', path: ['subscription'], message: 'webpush takes a subscription, not a token' });
			return;
		}
		if (!v.token || v.subscription) {
			ctx.addIssue({ code: 'custom', path: ['token'], message: `${v.provider} takes a token` });
			return;
		}
		const checked = TOKEN_FORMATS[v.provider].safeParse(v.token);
		if (!checked.success) ctx.addIssue({ code: 'custom', path: ['token'], message: checked.error.issues[0]?.message ?? 'invalid token' });
	});
export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;

export interface PushDevice {
	installId: string;
	platform: string;
	provider: PushProvider;
	/** Last characters only: enough to tell devices apart, useless to send with. */
	tokenHint: string;
	locale: string | null;
	appVersion: string | null;
	categories: NotificationCategory[] | null;
	createdAt: number;
	updatedAt: number;
}

interface DeviceRow {
	install_id: string;
	user_id: string;
	platform: string;
	provider: PushProvider;
	token: string;
	locale: string | null;
	app_version: string | null;
	categories: string | null;
	created_at: number;
	updated_at: number;
}

/** The stored token: provider token, or the canonical Web Push subscription JSON. */
export function storedToken(reg: DeviceRegistration): string {
	if (reg.provider !== 'webpush') return reg.token!;
	const s = reg.subscription!;
	return JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
}

function tokenHint(row: Pick<DeviceRow, 'provider' | 'token'>): string {
	const raw = row.provider === 'webpush' ? (JSON.parse(row.token).endpoint as string) : row.token;
	return `…${raw.slice(-6)}`;
}

function parseCategories(raw: string | null): NotificationCategory[] | null {
	if (!raw) return null;
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
}

export function toDevice(row: DeviceRow): PushDevice {
	return {
		installId: row.install_id,
		platform: row.platform,
		provider: row.provider,
		tokenHint: tokenHint(row),
		locale: row.locale,
		appVersion: row.app_version,
		categories: parseCategories(row.categories),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export type RegisterResult = { ok: true; device: PushDevice; created: boolean } | { ok: false; reason: 'install_owned_by_another_user' };

export async function registerDevice(
	db: D1Database,
	userId: string,
	installId: string,
	reg: DeviceRegistration,
	now = Date.now(),
): Promise<RegisterResult> {
	const token = storedToken(reg);
	const existing = await db.prepare('SELECT * FROM push_devices WHERE install_id = ?').bind(installId).first<DeviceRow>();
	if (existing && existing.user_id !== userId && !(existing.provider === reg.provider && existing.token === token)) {
		return { ok: false, reason: 'install_owned_by_another_user' };
	}
	const categories = reg.categories ? JSON.stringify([...new Set(reg.categories)]) : null;
	await db.batch([
		// The token moves with the device: drop it from any other install
		db.prepare('DELETE FROM push_devices WHERE provider = ? AND token = ? AND install_id != ?').bind(reg.provider, token, installId),
		db
			.prepare(
				`INSERT INTO push_devices (install_id, user_id, platform, provider, token, locale, app_version, categories, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(install_id) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
				   provider = excluded.provider, token = excluded.token, locale = excluded.locale,
				   app_version = excluded.app_version, categories = excluded.categories, updated_at = excluded.updated_at`,
			)
			.bind(installId, userId, reg.platform, reg.provider, token, reg.locale ?? null, reg.appVersion ?? null, categories, now, now),
		// Cap per user: the least recently updated beyond the limit go
		db
			.prepare(
				`DELETE FROM push_devices WHERE user_id = ? AND install_id IN (
				   SELECT install_id FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC, install_id LIMIT -1 OFFSET ?)`,
			)
			.bind(userId, userId, MAX_DEVICES_PER_USER),
	]);
	const row = await db.prepare('SELECT * FROM push_devices WHERE install_id = ?').bind(installId).first<DeviceRow>();
	return { ok: true, device: toDevice(row!), created: !existing };
}

export async function listDevices(db: D1Database, userId: string): Promise<PushDevice[]> {
	const { results } = await db
		.prepare('SELECT * FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC, install_id')
		.bind(userId)
		.all<DeviceRow>();
	return results.map(toDevice);
}

/** Only the owner's row is removed; true when one was. */
export async function unregisterDevice(db: D1Database, userId: string, installId: string): Promise<boolean> {
	const res = await db.prepare('DELETE FROM push_devices WHERE install_id = ? AND user_id = ?').bind(installId, userId).run();
	return (res.meta?.changes ?? 0) > 0;
}

/** Account deletion / erasure: every device of the user. */
export async function deleteUserDevices(db: D1Database, userId: string): Promise<number> {
	const res = await db.prepare('DELETE FROM push_devices WHERE user_id = ?').bind(userId).run();
	return res.meta?.changes ?? 0;
}
