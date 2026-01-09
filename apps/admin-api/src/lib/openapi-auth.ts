// OpenAPI Authentication Helper for Admin API

export const AUTH_DESCRIPTIONS = {
  REQUIRED: "🔒 **Admin Authentication Required**: This endpoint requires a valid JWT token with admin/moderator role.",
  OPTIONAL: "🔓 **Authentication Optional**: This endpoint works without authentication but provides additional features when authenticated.",
  PUBLIC: "🌐 **Public Endpoint**: No authentication required."
};

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

export const FORBIDDEN_RESPONSE = {
  "403": {
    description: "Forbidden - insufficient admin/moderator permissions",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "string",
              example: "Admin or moderator role required"
            }
          }
        }
      }
    }
  }
};

export function addAuthToSchema(schema: any, authType: 'required' | 'optional' | 'public' = 'required') {
  const description = AUTH_DESCRIPTIONS[authType.toUpperCase() as keyof typeof AUTH_DESCRIPTIONS];

  return {
    ...schema,
    description: schema.description ? `${description}\n\n${schema.description}` : description,
    responses: {
      ...schema.responses,
      ...(authType === 'required' ? { ...UNAUTHORIZED_RESPONSE, ...FORBIDDEN_RESPONSE } : {})
    }
  };
}
