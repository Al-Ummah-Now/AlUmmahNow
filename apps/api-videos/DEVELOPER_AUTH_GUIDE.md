# Developer Authentication Guide

> **🔧 For API Developers**: This guide is for developers working on the Al-Ummah Now Videos API codebase. If you're using the API, see [AUTHENTICATION.md](./AUTHENTICATION.md).

This guide shows how to add authentication documentation to your OpenAPI endpoints when using Chanfana.

## Quick Reference

### Import the Helper
```typescript
import { addAuthToSchema, AUTH_DESCRIPTIONS, UNAUTHORIZED_RESPONSE } from "../../lib/openapi-auth";
```

### Authentication Types

#### 1. Required Authentication (POST, PUT, DELETE operations)
```typescript
export class VideoCreate extends OpenAPIRoute {
  schema = {
    tags: ["Videos"],
    summary: "Create a new Video",
    description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
    request: {
      headers: z.object({
        channelId: Str({ description: "Channel ID" }).optional(),
        userId: Str({ description: "User ID (automatically set from JWT token)" }).optional(),
      }),
      // ... rest of request
    },
    responses: {
      "200": { /* success response */ },
      "401": {
        description: "Unauthorized - missing or invalid authentication token",
        content: {
          "application/json": {
            schema: ResponseError,
          },
        },
      },
      // ... other responses
    }
  };
}
```

#### 2. Optional Authentication (GET operations)
```typescript
export class VideosList extends OpenAPIRoute {
  schema = {
    tags: ["Videos"],
    summary: "List Videos", 
    description: "🔓 **Authentication Optional**: This endpoint works without authentication but provides additional features when authenticated with a valid JWT token in the Authorization header (Bearer <token>).",
    request: {
      headers: z.object({
        channelId: Str({ description: "Channel ID" }).optional().nullable(),
        userId: Str({ description: "User ID (automatically set from JWT token if authenticated)" }).optional().nullable(),
      }),
      // ... rest of request
    },
    responses: {
      "200": { /* success response */ },
      // No 401 response needed for optional auth
    }
  };
}
```

#### 3. Public Endpoints (rare)
```typescript
export class HealthCheck extends OpenAPIRoute {
  schema = {
    tags: ["System"],
    summary: "Health Check",
    description: "🌐 **Public Endpoint**: No authentication required.",
    // No auth-related headers needed
  };
}
```

## Using the Helper Function

Instead of manually adding descriptions, you can use the helper:

```typescript
import { addAuthToSchema } from "../../lib/openapi-auth";

export class VideoCreate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Videos"],
    summary: "Create a new Video",
    request: { /* ... */ },
    responses: { /* ... */ }
  }, 'required'); // 'required', 'optional', or 'public'
}
```

## Icons and Visual Indicators

- 🔒 **Required Authentication**: Red lock icon for endpoints that require JWT
- 🔓 **Optional Authentication**: Open lock icon for endpoints that work with/without JWT  
- 🌐 **Public Endpoint**: Globe icon for endpoints that don't use authentication

## Common Patterns

### Headers for Authenticated Endpoints
```typescript
headers: z.object({
  channelId: Str({ description: "Channel ID" }).optional(),
  userId: Str({ description: "User ID (automatically set from JWT token)" }).optional(),
}),
```

### Headers for Optional Auth Endpoints
```typescript
headers: z.object({
  channelId: Str({ description: "Channel ID" }).optional().nullable(),
  userId: Str({ description: "User ID (automatically set from JWT token if authenticated)" }).optional().nullable(),
}),
```

### 401 Response Schema
```typescript
"401": {
  description: "Unauthorized - missing or invalid authentication token",
  content: {
    "application/json": {
      schema: ResponseError, // Or use inline schema
    },
  },
}
```

## Endpoint Categories

### Always Require Authentication
- POST operations (create)
- PUT/PATCH operations (update)  
- DELETE operations (delete)
- User-specific actions (likes, comments, subscriptions)

### Optional Authentication (Enhanced with Auth)
- GET operations that show private content when authenticated
- List operations with privacy filtering
- Search operations with personalized results

### No Authentication Needed
- Health checks
- Public documentation
- System status endpoints

## Authentication Flow Documentation

Add this to your API description:

```
## Authentication

This API uses JWT (JSON Web Token) authentication. To authenticate:

1. Obtain a JWT token from the authentication service
2. Include the token in the Authorization header: `Bearer <your-jwt-token>`
3. The API will automatically extract user information from the token

### Token Format
The JWT token should contain:
- `sub`: User ID (required)
- `email`: User email (optional)
- `exp`: Expiration timestamp
- `iat`: Issued at timestamp

### Error Responses
- `401 Unauthorized`: Missing, invalid, or expired token
- `403 Forbidden`: Valid token but insufficient permissions
```

## Testing with Authentication

When testing endpoints in the OpenAPI documentation:

1. Look for the 🔒 or 🔓 icons to identify auth requirements
2. For authenticated endpoints, you'll need to provide a valid JWT token
3. Use the descriptions to understand what authentication provides (e.g., access to private content)

This approach ensures clear documentation while working within Chanfana's constraints.