/**
 * First-run guides the signed-in viewer has seen (lib/onboarding.ts)
 * GET /api/profile/onboarding  -> { identityTour }
 * PUT /api/profile/onboarding  { identityTour } -> { identityTour }
 */
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { AuthenticatedRoute, AppContext } from "../../base";
import { getOnboarding, markOnboarding } from "../../lib/onboarding";
import { logger } from "../../lib/logger";

const OnboardingSchema = z.object({
	identityTour: z.number().int().min(0).max(1000).describe("Highest version of the identity tour the viewer finished or skipped (0 = never)"),
});

export class OnboardingGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ["Profiles"],
			summary: "Get which first-run guides the current user has seen",
			responses: {
				"200": { description: "Guides seen", content: { "application/json": { schema: OnboardingSchema } } },
				"401": { description: "Unauthorized" },
			},
		},
		"required",
	);

	async handle(c: AppContext) {
		return c.json(await getOnboarding(c.env.profiles, this.getUserId(c)), 200);
	}
}

export class OnboardingUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ["Profiles"],
			summary: "Record that the current user finished or skipped a first-run guide",
			description: "The stored version only grows: a lower version leaves it as it is.",
			request: { body: { content: { "application/json": { schema: OnboardingSchema } } } },
			responses: {
				"200": { description: "Guides seen", content: { "application/json": { schema: OnboardingSchema } } },
				"400": { description: "Invalid request data" },
				"401": { description: "Unauthorized" },
			},
		},
		"required",
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const email = (this.getAuth(c) as { email?: string }).email;
		const state = await markOnboarding(c.env.profiles, userId, email, { identityTour: body.identityTour });
		logger.debug("[Onboarding] Marked", { userId, identityTour: state.identityTour });
		return c.json(state, 200);
	}
}
