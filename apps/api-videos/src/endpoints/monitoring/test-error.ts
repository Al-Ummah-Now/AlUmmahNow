import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";

/**
 * Test Error Endpoint
 *
 * This endpoint is used to test error handling in development.
 * It intentionally throws different types of errors based on the type parameter.
 */
export class TestError extends OpenAPIRoute {
	schema = {
		tags: ["Monitoring"],
		summary: "Test error handling (development only)",
		description: "Intentionally throws errors to test error handling middleware. Only available in development mode.",
		request: {
			query: z.object({
				type: Str({
					description: "Type of error to throw: generic, validation, notfound, unauthorized, custom",
					example: "generic",
				}).optional().default("generic"),
				message: Str({
					description: "Custom error message",
					example: "Test error message",
				}).optional(),
			}),
		},
		responses: {
			"500": {
				description: "Intentional error for testing",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: z.string(),
							debug: z.any().optional(),
						}),
					},
				},
			},
		},
	};

	async handle(c) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { type, message } = data.query;

		const errorMessage = message || `Test ${type} error`;

		// Throw different types of errors based on the type parameter
		switch (type) {
			case "validation":
				const validationError = new Error(errorMessage);
				validationError.name = "ValidationError";
				(validationError as any).details = {
					field: "testField",
					value: "invalidValue",
					constraint: "Must be a valid UUID",
				};
				throw validationError;

			case "notfound":
				const notFoundError = new Error(errorMessage || "Resource not found");
				notFoundError.name = "NotFoundError";
				(notFoundError as any).status = 404;
				(notFoundError as any).resourceId = "test-resource-id-123";
				throw notFoundError;

			case "unauthorized":
				const unauthorizedError = new Error(errorMessage || "Unauthorized access");
				unauthorizedError.name = "UnauthorizedError";
				(unauthorizedError as any).status = 401;
				throw unauthorizedError;

			case "custom":
				const customError = new Error(errorMessage);
				customError.name = "CustomTestError";
				(customError as any).customField1 = "custom value 1";
				(customError as any).customField2 = { nested: "object" };
				(customError as any).timestamp = new Date().toISOString();
				throw customError;

			case "nested":
				const nestedError = new Error("Nested error - inner");
				const outerError = new Error(errorMessage || "Nested error - outer");
				(outerError as any).cause = nestedError;
				throw outerError;

			case "generic":
			default:
				throw new Error(errorMessage);
		}
	}
}
