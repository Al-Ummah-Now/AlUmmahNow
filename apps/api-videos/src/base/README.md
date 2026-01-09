# Base Route Classes

This directory contains base classes for API endpoints that eliminate repetitive authentication checks and make endpoint intent explicit.

## Files

### `types.ts`
Defines shared types used across all base classes:
- `AuthContext`: User authentication information (userId, email, JWT payload)
- `AppContext`: Hono context type with auth bindings

### `AuthenticatedRoute.ts`
Base class for endpoints that **REQUIRE** authentication.

**Features:**
- Automatically validates authentication before calling `handle()`
- Throws 401 if authentication is missing
- Provides `getAuth(c)` and `getUserId(c)` helpers (always non-null)
- Eliminates repetitive `if (!auth) return c.json(...)` checks

**When to use:**
- Creating/updating/deleting user-owned resources
- Accessing private user data
- Any operation requiring user identity

**Examples:** VideoCreate, VideoUpdate, VideoDelete, ProfileUpdate

### `OptionalAuthRoute.ts`
Base class for endpoints that work **with OR without** authentication.

**Features:**
- Provides `getAuth(c)` returning `AuthContext | undefined`
- Provides `getUserId(c)` returning `string | undefined`
- Provides `isAuthenticated(c)` boolean helper
- No automatic validation (endpoint handles both cases)

**When to use:**
- List endpoints showing private items to authenticated users
- Resource fetching with user-specific data when available
- Features that enhance with auth but work without it

**Examples:** VideoFetch (shows private videos to owner), VideoList

### `PublicRoute.ts`
Base class for endpoints that **never** need authentication.

**Features:**
- Semantic wrapper around `OpenAPIRoute`
- Makes public intent explicit
- Future-proof for shared public endpoint functionality

**When to use:**
- Health checks and monitoring
- Public data endpoints
- Infrastructure endpoints

**Examples:** HealthCheck, Metrics, StatusPage

## Migration Examples

### Before (OpenAPIRoute)

```typescript
import { OpenAPIRoute } from "chanfana";

export class VideoCreate extends OpenAPIRoute {
  schema = { /* ... */ };

  async handle(c) {
    // ❌ Repetitive auth check
    const auth = c.get('auth');
    if (!auth) {
      return c.json({
        success: false,
        error: "Authentication required"
      }, 401);
    }

    const userId = auth.userId;

    // Your endpoint logic here
    const video = await createVideo(userId, ...);
    return c.json({ video });
  }
}
```

### After (AuthenticatedRoute)

```typescript
import { AuthenticatedRoute, AppContext } from "../../base";

export class VideoCreate extends AuthenticatedRoute {
  schema = { /* ... */ };

  async handle(c: AppContext) {
    // ✅ No auth check needed - guaranteed by base class
    const userId = this.getUserId(c);

    // Your endpoint logic here
    const video = await createVideo(userId, ...);
    return c.json({ video });
  }
}
```

## Benefits

1. **Eliminates Boilerplate:** No more repetitive auth checks
2. **Type Safety:** `AppContext` provides proper typing for auth context
3. **Explicit Intent:** Class name declares auth requirements
4. **Consistent Error Handling:** 401 errors handled uniformly
5. **Better Developer Experience:** Helper methods reduce code noise
6. **Easier Testing:** Auth validation happens in one place
7. **Future-Proof:** Centralized location for auth enhancements

## Usage Statistics (Target)

After full migration:
- **AuthenticatedRoute:** ~60% of endpoints (video/profile/channel mutations)
- **OptionalAuthRoute:** ~30% of endpoints (fetch/list operations)
- **PublicRoute:** ~10% of endpoints (monitoring, health checks)

## Implementation Checklist

For each endpoint to be migrated:

- [ ] Identify auth requirement (required/optional/public)
- [ ] Change base class from `OpenAPIRoute` to appropriate base class
- [ ] Add `AppContext` type to `handle(c: AppContext)` signature
- [ ] Remove `const auth = c.get('auth')` and null checks
- [ ] Replace `auth.userId` with `this.getUserId(c)`
- [ ] Replace `auth` with `this.getAuth(c)`
- [ ] For optional auth: use `this.isAuthenticated(c)` for conditionals
- [ ] Test endpoint with and without authentication
- [ ] Verify OpenAPI schema still generates correctly

## Testing

After migration, verify:
1. Type checking passes: `npx tsc --noEmit`
2. Authenticated endpoints reject requests without tokens (401)
3. Optional auth endpoints work with and without tokens
4. Public endpoints work without tokens
5. OpenAPI schema includes correct security requirements
6. Swagger UI shows auth properly (lock icons)
