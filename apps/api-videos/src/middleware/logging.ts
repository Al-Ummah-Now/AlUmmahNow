import { Context, Next } from 'hono';

/**
 * Sanitize sensitive headers
 */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
	const sanitized = { ...headers };

	// Sanitize Authorization header
	if (sanitized.authorization) {
		const parts = sanitized.authorization.split(' ');
		if (parts.length === 2 && parts[0] === 'Bearer') {
			sanitized.authorization = `Bearer ${parts[1].substring(0, 20)}...`;
		}
	}

	return sanitized;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Comprehensive logging middleware for ALL API requests
 * Logs in a consistent format matching frontend logging
 */
export async function loggingMiddleware(c: Context, next: Next) {
	const requestId = generateRequestId();
	const startTime = Date.now();

	// Extract request information
	const method = c.req.method;
	const url = c.req.url;
	const path = new URL(url).pathname;
	const query = new URL(url).searchParams.toString();

	// Get headers
	const rawHeaders: Record<string, string> = {};
	c.req.raw.headers.forEach((value, key) => {
		rawHeaders[key] = value;
	});
	const headers = sanitizeHeaders(rawHeaders);

	// Get authentication context if available
	const userId = c.get('userId') || c.req.header('userId') || 'unauthenticated';
	const auth = c.get('auth');

	console.log('========================================');
	console.log(`[API REQUEST] ========== START ==========`);
	console.log(`[API REQUEST] Request ID: ${requestId}`);
	console.log(`[API REQUEST] Timestamp: ${new Date().toISOString()}`);
	console.log(`[API REQUEST] Method: ${method}`);
	console.log(`[API REQUEST] Path: ${path}`);
	if (query) {
		console.log(`[API REQUEST] Query: ${query}`);
	}
	console.log(`[API REQUEST] User ID: ${userId}`);
	console.log(`[API REQUEST] Headers:`, JSON.stringify(headers, null, 2));

	// Log authentication context
	if (auth) {
		console.log(`[API REQUEST] Auth Context:`, {
			userId: auth.userId,
			email: auth.email
		});
	}

	// Log request body for POST/PUT/PATCH
	if (['POST', 'PUT', 'PATCH'].includes(method)) {
		try {
			// Clone the raw request to read the body without consuming it
			const clonedReq = c.req.raw.clone();
			const contentType = c.req.header('content-type');

			if (contentType?.includes('application/json')) {
				const body = await clonedReq.json();
				console.log(`[API REQUEST] Body:`, JSON.stringify(body, null, 2));
			} else if (contentType?.includes('multipart/form-data')) {
				console.log(`[API REQUEST] Body: [FormData - File Upload]`);
			} else {
				console.log(`[API REQUEST] Body: [${contentType || 'unknown content type'}]`);
			}
		} catch (error) {
			console.log(`[API REQUEST] Body: [Unable to parse]`);
		}
	}

	console.log(`[API REQUEST] ========== PROCESSING ==========`);

	// Process the request
	let error: any = null;
	try {
		await next();
	} catch (err) {
		error = err;
		throw err; // Re-throw to let error handlers catch it
	} finally {
		const endTime = Date.now();
		const duration = endTime - startTime;
		const status = c.res.status;

		console.log(`[API RESPONSE] ========== END ==========`);
		console.log(`[API RESPONSE] Request ID: ${requestId}`);
		console.log(`[API RESPONSE] Status: ${status}`);
		console.log(`[API RESPONSE] Duration: ${duration}ms`);

		// Log response body for errors or successful creates/updates
		if (error) {
			console.error(`[API RESPONSE] ❌ Error:`, {
				error,
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined
			});
		} else {
			// Log response body for certain status codes
			if (status >= 400 || method !== 'GET') {
				try {
					// Clone response to read body
					const clonedRes = c.res.clone();
					const responseBody = await clonedRes.text();

					try {
						const json = JSON.parse(responseBody);
						console.log(`[API RESPONSE] Body:`, JSON.stringify(json, null, 2));
					} catch {
						// Not JSON
						console.log(`[API RESPONSE] Body:`, responseBody.substring(0, 500));
					}
				} catch {
					console.log(`[API RESPONSE] Body: [Unable to read]`);
				}
			}

			// Success indicator
			if (status >= 200 && status < 300) {
				console.log(`[API RESPONSE] ✅ Success`);
			} else if (status >= 400 && status < 500) {
				console.log(`[API RESPONSE] ⚠️  Client Error`);
			} else if (status >= 500) {
				console.log(`[API RESPONSE] ❌ Server Error`);
			}
		}

		console.log('========================================');
	}
}
