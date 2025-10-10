// OpenAPI Authentication Helper
// This file contains reusable patterns for documenting authentication in OpenAPI
// Note: Chanfana may not fully support OpenAPI 3.1 security schemes, so we use descriptions instead

// Authentication descriptions for endpoint documentation
export const AUTH_DESCRIPTIONS = {
  REQUIRED: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
  OPTIONAL: "🔓 **Authentication Optional**: This endpoint works without authentication but provides additional features when authenticated with a valid JWT token in the Authorization header (Bearer <token>).",
  PUBLIC: "🌐 **Public Endpoint**: No authentication required."
};

// Common 401 response for authenticated endpoints
export const UNAUTHORIZED_RESPONSE = {
  "401": {
    description: "Unauthorized - missing or invalid authentication token",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { 
              type: "string", 
              example: "Missing or invalid Authorization header. Expected: Bearer <token>" 
            }
          }
        }
      }
    }
  }
};

// Helper to add auth description and 401 response to schema
export function addAuthToSchema(schema: any, authType: 'required' | 'optional' | 'public' = 'required') {
  const description = AUTH_DESCRIPTIONS[authType.toUpperCase() as keyof typeof AUTH_DESCRIPTIONS];
  
  return {
    ...schema,
    description: schema.description ? `${description}\n\n${schema.description}` : description,
    responses: {
      ...schema.responses,
      ...(authType === 'required' ? UNAUTHORIZED_RESPONSE : {})
    }
  };
}

// Updated headers for authenticated endpoints
export const AUTH_HEADERS_REQUIRED = {
  channelId: "Channel ID (optional)",
  userId: "User ID (automatically set from JWT token)"
};

export const AUTH_HEADERS_OPTIONAL = {
  channelId: "Channel ID (optional)",
  userId: "User ID (automatically set from JWT token if authenticated)"
};