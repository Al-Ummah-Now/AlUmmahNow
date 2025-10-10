# API Authentication Guide

> **📖 For API Users**: This guide is for developers using the Al-Ummah Now Videos API. If you're working on the API codebase itself, see [DEVELOPER_AUTH_GUIDE.md](./DEVELOPER_AUTH_GUIDE.md).

This API includes authentication middleware that integrates with OpenAuth (SST) for JWT token validation.

## Testing with Interactive Documentation

🎯 **Quick Start**: Use our OpenAPI-compliant Swagger UI to test authenticated endpoints:
- **Interactive Documentation**: `/` - Full OpenAPI 3.0 Bearer authentication support with 🔐 **Authorize** button
- **OpenAPI Schema**: `/openapi.json` - Specification-compliant Bearer authentication schema

### Testing Authenticated Endpoints
1. Open the API documentation at your base URL (e.g., `http://localhost:8686/`)
2. Look for the 🔐 **Authorize** button in the top-right corner of the Swagger UI
3. Click the button and enter your JWT token in the format: `Bearer your-jwt-token-here`
4. Click **Authorize** to apply the token to all subsequent requests
5. Test the `/auth-test` endpoint to verify authentication is working
6. All authenticated endpoint calls will now automatically include your Bearer token

### Bearer Authentication Specification Compliance
Our implementation follows the official [OpenAPI 3.0 Bearer Authentication specification](https://swagger.io/docs/specification/v3_0/authentication/bearer-authentication/):

- ✅ **Security Scheme**: `type: http`, `scheme: bearer`, `bearerFormat: JWT`
- ✅ **Security Application**: Applied per-endpoint with empty scopes `[{ BearerAuth: [] }]`
- ✅ **Shared Error Responses**: 401/403 responses using `$ref` for reusability
- ✅ **Standard HTTP Headers**: Uses `Authorization: Bearer <token>` format

## Authentication Flow

1. **User Authentication**: Users authenticate through your UI app, which uses another auth app that implements OpenAuth
2. **JWT Token**: The auth app issues JWT tokens to authenticated users
3. **API Requests**: Your UI app includes the JWT token in API requests via the `Authorization` header
4. **Token Validation**: This API validates the JWT token and extracts user information

## Request Headers

### Required for Authenticated Endpoints
```
Authorization: Bearer <jwt-token>
```

### Optional Headers (for backward compatibility)
```
channelId: <channel-id>
userId: <user-id>  // Will be overridden by JWT token if present
```

## Endpoint Authentication Requirements

### Public Endpoints (No Authentication Required)
- `GET /api/videos` - List videos (with optional privacy filtering)
- `GET /api/videos/:id` - Get video details
- `GET /api/profiles` - List profiles  
- `GET /api/profiles/:id` - Get profile details
- `GET /api/playlists` - List playlists (with privacy filtering)
- `GET /api/playlists/:id` - Get playlist details
- `GET /api/channels` - List channels
- `GET /api/channels/:id` - Get channel details
- `GET /` - OpenAPI documentation
- `GET /openapi.json` - OpenAPI schema

### Authenticated Endpoints (JWT Token Required)
- `POST /api/videos` - Create video
- `DELETE /api/videos/:id` - Delete video
- `POST /api/profiles` - Create profile
- `PUT /api/profiles/:id` - Update profile
- `DELETE /api/profiles/:id` - Delete profile
- `PUT /api/profiles/:id/avatar` - Update profile avatar
- `PUT /api/profiles/:id/cover` - Update profile cover
- All playlist management endpoints (POST, PATCH, DELETE)
- All channel management endpoints (POST, DELETE)
- All subscription endpoints
- All comment endpoints
- All like/dislike endpoints

## JWT Token Format

The JWT token should contain at minimum:
```json
{
  "sub": "user-id",        // Subject (User ID) - Required
  "email": "user@email",   // User email - Optional
  "iat": 1640995200,      // Issued at timestamp
  "exp": 1641081600,      // Expiration timestamp
  "aud": "your-app",      // Audience - Optional
  "iss": "your-auth-app"  // Issuer - Optional
}
```

## Authentication Responses

### Success
When authentication is successful, the user context is available in endpoints:
```typescript
const authContext = getAuthContext(c);
const userId = authContext?.userId; // User ID from JWT
const userEmail = authContext?.email; // User email from JWT
```

### Authentication Failures

#### Missing Token (401)
```json
{
  "success": false,
  "error": "Missing or invalid Authorization header. Expected: Bearer <token>"
}
```

#### Invalid Token (401)
```json
{
  "success": false,
  "error": "Invalid or expired authentication token"
}
```

#### Expired Token (401)
```json
{
  "success": false,
  "error": "Invalid or expired authentication token"
}
```

## Configuration

### Basic Setup (Current)
- Simple JWT payload validation
- Expiration check
- No signature verification (for development)

### Production Setup (Recommended)
To enable proper JWT signature verification, update `src/middleware/auth.ts`:

1. **Option A**: Verify with your auth service
```typescript
// Set your auth service URL in environment
const AUTH_SERVICE_URL = "https://your-auth-app.com";

// The middleware will call your auth service to verify tokens
```

2. **Option B**: Use public key verification
```typescript
// Implement proper JWT signature verification using Web Crypto API
// with your auth service's public key
```

## Environment Variables

Add these to your `wrangler.toml` or environment:

```toml
[vars]
AUTH_SERVICE_URL = "https://your-auth-app.com"  # Optional: for auth service verification
```

## Privacy Filtering

GET endpoints implement privacy filtering:
- **Public content**: Always visible to everyone
- **Private content**: Only visible to the owner (requires authentication)
- **isPublic field**: 
  - `true` = Public (visible to all)
  - `false` = Private (owner only) 
  - `null/undefined` = Public (default)

## CORS Configuration

The API includes comprehensive CORS headers:
- **Origins**: `*` (all origins allowed)
- **Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization, X-Requested-With, channelId, userId
- **Preflight**: Properly handled with 204 responses

## Testing Authentication

### Test with curl
```bash
# Public endpoint (no auth required)
curl https://videos.api.alummahnow.net/api/videos

# Authenticated endpoint
curl -H "Authorization: Bearer <your-jwt-token>" \
     https://videos.api.alummahnow.net/api/videos \
     -X POST \
     -H "Content-Type: application/json" \
     -d '{"title":"Test Video"}'
```

### Test with JavaScript
```javascript
// Public request
const response = await fetch('https://videos.api.alummahnow.net/api/videos');

// Authenticated request
const authResponse = await fetch('https://videos.api.alummahnow.net/api/videos', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ title: 'Test Video' })
});
```