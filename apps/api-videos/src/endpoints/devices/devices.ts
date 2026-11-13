/**
 * Push device registration (Epic 9.4). Authenticated; only the caller's own rows.
 *
 * GET    /api/devices               my registered devices (tokens redacted)
 * PUT    /api/devices/:installId    register / refresh this install's push token
 * DELETE /api/devices/:installId    unregister (call on sign-out)
 *
 * Which categories reach a device: the user's /api/notifications/settings,
 * narrowed by the device's optional `categories`.
 */
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { ResponseError } from "../../lib/types";
import { isStaff } from "@al-ummah/shared-types";
import { DeviceRegistrationSchema, InstallIdSchema, listDevices, registerDevice, unregisterDevice } from "../../lib/push-devices";

const unavailable = { "503": { description: "Notifications not configured", content: { "application/json": { schema: ResponseError } } } };
const Params = z.object({ installId: InstallIdSchema });

function storeUnavailable(c: AppContext) {
	logger.warn("[Devices] NOTIFICATIONS_DB not bound");
	return c.json({ success: false, error: "notifications_unavailable" }, 503);
}

export class DevicesList extends AuthenticatedRoute {
	schema = {
		tags: ["Devices"],
		summary: "My push-registered devices",
		responses: { "200": { description: "{ devices }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		return { success: true, result: { devices: await listDevices(db, this.getUserId(c)) } };
	}
}

export class DeviceRegister extends AuthenticatedRoute {
	schema = {
		tags: ["Devices"],
		summary: "Register or refresh this install's push token",
		description:
			"Idempotent; call on every launch and whenever the OS rotates the token. APNs/FCM take `token`, WNS takes the channel URI as `token`, Web Push takes `subscription` (PushSubscription.toJSON()). `app` names the app that owns the install (`viewer` when omitted, for older clients); `admin` installs need a staff role.",
		request: { params: Params, body: { content: { "application/json": { schema: DeviceRegistrationSchema } } } },
		responses: {
			"200": { description: "{ device, created }" },
			"403": { description: "Only staff may register an Admin app install", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "This install is registered to another account with a different token", content: { "application/json": { schema: ResponseError } } },
			...unavailable,
		},
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		if (body.app === "admin" && !isStaff(this.getAuth(c).payload?.roles)) {
			logger.debug("[Devices] Admin install refused: no staff role", { userId, installId: params.installId });
			return c.json({ success: false, error: "staff_only" }, 403);
		}
		const result = await registerDevice(db, userId, params.installId, body);
		if ("reason" in result) {
			logger.warn("[Devices] Install owned by another user", { userId, installId: params.installId });
			return c.json({ success: false, error: result.reason }, 409);
		}
		return { success: true, result: { device: result.device, created: result.created } };
	}
}

export class DeviceUnregister extends AuthenticatedRoute {
	schema = {
		tags: ["Devices"],
		summary: "Unregister this install (sign-out)",
		request: { params: Params },
		responses: {
			"200": { description: "{ installId }" },
			"404": { description: "Not my device", content: { "application/json": { schema: ResponseError } } },
			...unavailable,
		},
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		if (!(await unregisterDevice(db, this.getUserId(c), params.installId))) {
			return c.json({ success: false, error: "not_found" }, 404);
		}
		return { success: true, result: { installId: params.installId } };
	}
}
