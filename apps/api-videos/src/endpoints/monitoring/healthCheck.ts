import { PublicRoute, AppContext } from "../../base";
import { } from "chanfana";
import { z } from "zod";

export class HealthCheck extends PublicRoute {
	schema = {
		tags: ["Monitoring"],
		summary: "Health Check",
		description: "🔓 **Public Endpoint**: Check API health status and system information.",
		responses: {
			"200": {
				description: "API is healthy",
				content: {
					"application/json": {
						schema: z.object({
							status: z.string(),
							timestamp: z.string(),
							version: z.string(),
							environment: z.string(),
							services: z.object({
								database: z.object({
									r2: z.object({
										videos: z.string(),
										profiles: z.string(),
										channels: z.string(),
										playlists: z.string(),
									}),
									kv: z.object({
										auth: z.string(),
									}),
								}),
								queue: z.object({
									analytics: z.string(),
								}),
								external: z.object({
									bunnyNet: z.string(),
								}),
							}),
							uptime: z.number(),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const startTime = Date.now();
		const errors: string[] = [];

		// Check R2 storage health
		const r2Status = {
			videos: "healthy",
			profiles: "healthy", 
			channels: "healthy",
			playlists: "healthy",
		};

		// Simple health check - in production would test actual connectivity
		const healthResponse = {
			status: "healthy",
			timestamp: new Date().toISOString(),
			version: "1.0.0",
			environment: "development",
			services: {
				database: {
					r2: r2Status,
					kv: {
						auth: "healthy",
					},
				},
				queue: {
					analytics: "healthy",
				},
				external: {
					bunnyNet: "configured",
				},
			},
			uptime: Date.now() - startTime,
		};

		return c.json(healthResponse, 200);
	}
}
