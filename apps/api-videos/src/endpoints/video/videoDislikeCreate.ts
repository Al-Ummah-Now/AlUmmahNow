import { Str } from "chanfana";
import { z } from "zod";
import { DISLIKES_DISABLED_CODE, DISLIKES_DISABLED_MESSAGE } from "@al-ummah/shared-types";
import { ResponseError } from "../../lib/types";
import { AuthenticatedRoute, AppContext } from '../../base';
import { ReactorHeaders } from "../../lib/reactions";

const DislikesDisabledError = ResponseError.extend({
	code: z.literal(DISLIKES_DISABLED_CODE),
	messages: z.object({ en: Str(), ar: Str() }).describe("The message in both site languages"),
});

/**
 * Disabled by owner decision 2026-11-11: dislikes are hidden and not accepted.
 * Like and remove-reaction still work. Re-enable only with an owner decision.
 *
 * The route stays registered so older clients get a clear 410 with a typed
 * code instead of a 404. DELETE /:id/dislikes (videoDislikeDelete) still
 * clears a dislike stored before this date, and liking clears it too.
 */
export class DislikeCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Dislikes"],
		summary: "Dislike a video (disabled: always 410 dislikes_disabled)",
		description: "Dislikes were turned off on 2026-11-11. This always answers 410 Gone with code `dislikes_disabled` and stores nothing. Use DELETE /api/videos/{id}/dislikes to clear an old dislike.",
		deprecated: true,
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: ReactorHeaders,
		},
		responses: {
			"410": {
				description: "Dislikes are turned off (code dislikes_disabled). `error` is in the language asked for with ?lang=ar, English otherwise.",
				content: {
					"application/json": {
						schema: DislikesDisabledError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const lang = c.req.query('lang') === 'ar' ? 'ar' : 'en';
		return c.json({
			success: false,
			code: DISLIKES_DISABLED_CODE,
			error: DISLIKES_DISABLED_MESSAGE[lang],
			messages: DISLIKES_DISABLED_MESSAGE,
		}, 410);
	}
}
