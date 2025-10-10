import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";

export class AuthTest extends OpenAPIRoute {
	schema = {
		summary: "🔐 Test JWT Authentication",
		description: "Test endpoint to verify JWT authentication is working correctly. Requires a valid Bearer token.",
		tags: ["Authentication"],
		security: [
			{
				BearerAuth: []
			}
		],
		responses: {
			"200": {
				description: "Authentication successful",
				content: {
					"application/json": {
						schema: z.object({
							message: z.string().openapi({ example: "🎉 Authentication successful!" }),
							authenticated: z.boolean().openapi({ example: true }),
							user: z.object({
								id: z.string().openapi({ example: "user123" }),
								email: z.string().openapi({ example: "user@example.com" }),
							}),
							metadata: z.object({
								hasAuth: z.boolean(),
								hasUserId: z.boolean(),
							}),
							timestamp: z.string().openapi({ example: "2025-09-21T12:00:00.000Z" })
						}).openapi("AuthTestResponse")
					}
				}
			},
			"401": {
				description: "Authentication required - missing or invalid JWT token",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().openapi({ example: false }),
							error: z.string().openapi({ example: "Missing or invalid Authorization header. Expected: Bearer <token>" })
						}).openapi("AuthError")
					}
				}
			}
		}
	};

	async handle(c: Context) {
		// Use type assertion to access context (workaround for TypeScript constraints)
		const context = c as any;
		const auth = context.get('auth');
		const userId = context.get('userId');
		
		return c.json({
			message: "🎉 Authentication successful!",
			authenticated: true,
			user: {
				id: userId || auth?.userId || 'unknown',
				email: auth?.email || 'unknown',
			},
			metadata: {
				hasAuth: !!auth,
				hasUserId: !!userId,
			},
			timestamp: new Date().toISOString()
		});
	}
}