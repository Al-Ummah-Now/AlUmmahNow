# JWT Authentication Security Audit - CRITICAL P0 Issue

**Date**: November 23, 2025
**Severity**: **CRITICAL (P0)**
**Status**: ACTIVE VULNERABILITY
**Component**: API Videos Application

---

## Executive Summary

A **CRITICAL SECURITY VULNERABILITY** has been identified in the Al Ummah Now API Videos application. While JWT token validation is implemented and configured (`VERIFY_JWT_SIGNATURE: true`), multiple endpoints are accepting `userId` from request headers as a fallback mechanism, potentially allowing authentication bypass. This vulnerability could allow attackers to impersonate any user by simply providing a userId header without a valid JWT token.

### Key Findings:
1. **JWT validation is properly configured** but inconsistently enforced
2. **6+ endpoints** directly read `userId` from headers as a fallback
3. **Authentication middleware** is correctly validating tokens but endpoints have dangerous fallback logic
4. **OpenAuth integration** exists and is properly configured but undermined by header fallback

---

## 1. Current State Analysis

### 1.1 Authentication Configuration

**File**: `/apps/api-videos/src/middleware/auth-config.ts`
```typescript
export const AUTH_CONFIG = {
  VERIFY_JWT_SIGNATURE: true, // ✅ ENABLED - Good!
  SUBJECTS: subjects,
  JWT: {
    ALGORITHM: 'RS256' as const,
  },
  // ... public routes configuration
}
```

**Environment Variables** (from `wrangler.jsonc`):
```json
"vars": {
  "ClientId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "Issuer": "https://auth.alummahnow.net",
  "Audience": "https://videos.alummahnow.net"
}
```

### 1.2 JWT Validation Implementation

**Current Flow**:
1. ✅ `authMiddleware` extracts Bearer token from Authorization header
2. ✅ With `VERIFY_JWT_SIGNATURE: true`, it calls `validateJWTWithSignature()`
3. ✅ OpenAuth client verifies token signature using `client.verify()`
4. ✅ Sets `userId` in context from JWT payload (`payload.sub`)
5. ⚠️ **PROBLEM**: Endpoints then check for `userId` from headers as fallback!

### 1.3 Critical Vulnerability Pattern

**Example from** `/apps/api-videos/src/endpoints/video/videoCreate.ts`:
```typescript
async handle(c) {
  const request = await this.getValidatedData<typeof this.schema>();

  // ❌ VULNERABLE: Accepting userId from headers!
  const { userId, channelId } = request.headers;

  // Getting auth context (proper way)
  const authContext = getAuthContext(c);

  // ❌ CRITICAL BUG: Fallback allows header override!
  const effectiveUserId = userId || authContext?.userId;

  if (!effectiveUserId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  // User can now act as effectiveUserId without authentication!
}
```

### 1.4 Affected Endpoints

Based on code analysis, the following endpoints are vulnerable:

#### **Direct Header Reading** (Most Critical):
1. **Video Upload Operations**:
   - `/api/videos/upload/initiate` - Lines 124: `const channelId = c.req.header('channelId') || userId;`
   - `/api/videos/upload` - Line 177: `const channelId = c.req.header('channelId') || userId;`
   - `/api/videos/tus/*` - TUS proxy validates userId from session

2. **Profile Operations**:
   - `/api/profiles/:id/avatar` - Lines 18-19: Reads `userId` and `channelId` from headers
   - `/api/profiles/:id/cover` - Lines 18-19: Reads `userId` and `channelId` from headers

3. **Channel Operations**:
   - `/api/channels/:id/avatar` - Line 80: `userId: c.req.header('userId')`
   - `/api/channels/:id/cover` - Line 80: `userId: c.req.header('userId')`

#### **Schema-Based Header Acceptance** (Through chanfana validation):
Multiple endpoints define `userId` in their OpenAPI schema headers, allowing it to be passed and potentially override auth:
- Video CRUD operations
- Profile management
- Channel management
- Playlist operations
- Community posts

### 1.5 Security Impact Assessment

**Attack Vectors**:
1. **User Impersonation**: Attacker can perform actions as any user by setting `userId` header
2. **Data Manipulation**: Create/modify/delete content on behalf of other users
3. **Privacy Breach**: Access private videos, profiles, and watch history
4. **Content Hijacking**: Upload videos to other users' channels
5. **Complete Account Takeover**: Modify profile, channel settings, delete content

**Exploitation Example**:
```bash
# Without any authentication, attacker can:
curl -X POST https://api.alummahnow.net/api/videos \
  -H "userId: victim-user-id" \
  -H "channelId: victim-channel-id" \
  -d '{"title": "Malicious Video", ...}'
```

---

## 2. Implementation Plan

### 2.1 Immediate Fixes (Phase 1 - URGENT)

#### Step 1: Remove ALL Header Fallbacks
**Priority**: IMMEDIATE
**Time**: 2-4 hours

1. **Remove header extraction from all endpoints**:
   ```typescript
   // ❌ REMOVE THIS PATTERN:
   const { userId, channelId } = request.headers;
   const effectiveUserId = userId || authContext?.userId;

   // ✅ REPLACE WITH:
   const authContext = getAuthContext(c);
   if (!authContext) {
     return c.json({ error: "Authentication required" }, 401);
   }
   const userId = authContext.userId;
   const channelId = c.req.param('channelId') || userId; // From URL params only
   ```

2. **Update OpenAPI schemas** - Remove userId from header definitions:
   ```typescript
   // ❌ REMOVE:
   headers: z.object({
     userId: z.string().optional(),
     channelId: z.string().optional(),
   })

   // ✅ KEEP ONLY:
   headers: z.object({
     // Remove user-controlled auth headers
   })
   ```

#### Step 2: Enforce Strict Authentication
**Files to modify**:
- `/apps/api-videos/src/endpoints/video/videoCreate.ts`
- `/apps/api-videos/src/endpoints/video/videoUpload.ts`
- `/apps/api-videos/src/endpoints/video/uploadInitiate.ts`
- `/apps/api-videos/src/endpoints/profile/profileAvatarUpdate.ts`
- `/apps/api-videos/src/endpoints/profile/profileCoverUpdate.ts`
- `/apps/api-videos/src/endpoints/channel/channelAvatarUpdate.ts`
- `/apps/api-videos/src/endpoints/channel/channelCoverUpdate.ts`
- All other endpoints using header-based userId

**Pattern to implement**:
```typescript
export class SecureEndpoint extends OpenAPIRoute {
  async handle(c: Context) {
    // 1. Get auth context from middleware (already validated)
    const authContext = getAuthContext(c);

    // 2. Enforce authentication
    if (!authContext || !authContext.userId) {
      return c.json({
        success: false,
        error: "Authentication required. Please provide a valid JWT token."
      }, 401);
    }

    // 3. Use ONLY the validated userId
    const userId = authContext.userId;
    const email = authContext.email;

    // 4. For channel operations, validate ownership
    const channelId = c.req.param('channelId');
    if (channelId) {
      // Verify user owns the channel
      const channel = await channelRepo.getObject(channelId);
      if (!channel || channel.ownerId !== userId) {
        return c.json({
          success: false,
          error: "Unauthorized: You don't own this channel"
        }, 403);
      }
    }

    // ... rest of the logic
  }
}
```

### 2.2 Enhanced Security (Phase 2)

#### Step 3: Add Request Signing
**Time**: 4-6 hours

1. **Implement request signature validation**:
   ```typescript
   // Add HMAC signature validation for sensitive operations
   const signature = c.req.header('X-Request-Signature');
   const timestamp = c.req.header('X-Request-Timestamp');

   if (!validateRequestSignature(signature, timestamp, body)) {
     return c.json({ error: "Invalid request signature" }, 403);
   }
   ```

2. **Add rate limiting per authenticated user**:
   ```typescript
   const rateLimitKey = `rate:${authContext.userId}:${endpoint}`;
   if (await isRateLimited(rateLimitKey)) {
     return c.json({ error: "Rate limit exceeded" }, 429);
   }
   ```

#### Step 4: Implement Audit Logging
**Time**: 2-3 hours

```typescript
// Log all authenticated actions
await auditLog.record({
  userId: authContext.userId,
  action: 'video.create',
  resourceId: videoId,
  ip: c.req.header('CF-Connecting-IP'),
  timestamp: new Date().toISOString(),
  requestId: c.get('requestId')
});
```

### 2.3 Configuration Updates

#### Update auth-config.ts:
```typescript
export const AUTH_CONFIG = {
  VERIFY_JWT_SIGNATURE: true,
  ENFORCE_STRICT_AUTH: true, // New flag
  ALLOW_HEADER_OVERRIDE: false, // Explicitly disable
  TOKEN_EXPIRY: 3600, // 1 hour
  REFRESH_TOKEN_EXPIRY: 604800, // 7 days
  // ...
}
```

#### Add security headers middleware:
```typescript
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000');
  return next();
});
```

---

## 3. Testing Strategy

### 3.1 Security Test Cases

#### Test 1: Header Override Prevention
```typescript
describe('Authentication Security', () => {
  it('should reject requests with userId header but no JWT', async () => {
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'userId': 'attacker-specified-id',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test' })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Missing or invalid Authorization header. Expected: Bearer <token>'
    });
  });

  it('should reject requests with invalid JWT', async () => {
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid.token.here',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test' })
    });

    expect(response.status).toBe(401);
  });

  it('should accept requests with valid JWT only', async () => {
    const validToken = await getValidTestToken();
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test' })
    });

    expect(response.status).toBe(200);
  });
});
```

### 3.2 Penetration Testing Checklist

- [ ] **Token Validation**:
  - [ ] Expired tokens are rejected
  - [ ] Tokens with invalid signatures are rejected
  - [ ] Tokens from wrong issuer are rejected
  - [ ] Tokens with wrong audience are rejected

- [ ] **Header Injection**:
  - [ ] userId header cannot override JWT subject
  - [ ] channelId header cannot bypass ownership checks
  - [ ] No authentication bypass via header manipulation

- [ ] **Authorization Checks**:
  - [ ] Users cannot modify other users' content
  - [ ] Users cannot access private content of others
  - [ ] Channel operations verify ownership

- [ ] **Edge Cases**:
  - [ ] Malformed JWT handling
  - [ ] Missing Authorization header
  - [ ] Multiple Authorization headers
  - [ ] Case sensitivity in header names

### 3.3 Load Testing

```bash
# Test authenticated endpoint performance
k6 run --vus 100 --duration 30s auth-load-test.js

# Monitor for:
# - Token validation performance < 50ms
# - No memory leaks in auth middleware
# - Proper connection pooling for OpenAuth
```

---

## 4. Deployment Plan

### 4.1 Staging Deployment (Day 1)

**Pre-deployment**:
1. ✅ Review all code changes
2. ✅ Run full test suite
3. ✅ Security scan with Snyk/Veracode
4. ✅ Update API documentation

**Deployment Steps**:
```bash
# 1. Deploy to staging
cd apps/api-videos
pnpm wrangler deploy --env staging

# 2. Run staging tests
pnpm test:staging

# 3. Penetration test staging
./security/pentest-staging.sh

# 4. Monitor for 24 hours
```

### 4.2 Production Deployment (Day 2-3)

**Canary Deployment** (10% traffic):
```bash
# Deploy to canary workers
pnpm wrangler deploy --env canary

# Monitor metrics for 2 hours
# - Authentication success rate > 99%
# - No increase in 401/403 errors
# - Performance within SLA
```

**Full Deployment**:
```bash
# If canary successful
pnpm wrangler deploy --env production

# Immediate verification
./scripts/verify-production-auth.sh
```

### 4.3 Rollback Plan

**Automatic Rollback Triggers**:
- Authentication success rate < 95%
- 401 error rate > 5%
- Response time > 200ms p99

**Manual Rollback**:
```bash
# Rollback to previous version
wrangler rollback --env production

# Verify rollback
curl https://api.alummahnow.net/health

# Notify team
./scripts/notify-rollback.sh
```

### 4.4 Monitoring & Alerting

**Key Metrics**:
```typescript
// Monitor these in real-time
const metrics = {
  authSuccessRate: meter.createCounter('auth.success'),
  authFailureRate: meter.createCounter('auth.failure'),
  jwtValidationTime: meter.createHistogram('jwt.validation.duration'),
  unauthorizedAttempts: meter.createCounter('auth.unauthorized'),
  headerOverrideAttempts: meter.createCounter('auth.header.override.blocked')
};
```

**Alert Thresholds**:
- JWT validation failures > 100/min → Page on-call
- Unauthorized attempts > 1000/min → Security team alert
- Header override attempts > 10/min → Investigate potential attack

---

## 5. Timeline Estimate

### Phase 1: Critical Fix (24-48 hours)
- **Hour 0-2**: Remove header fallbacks from critical endpoints
- **Hour 2-4**: Update OpenAPI schemas
- **Hour 4-8**: Testing and validation
- **Hour 8-24**: Staging deployment and monitoring
- **Hour 24-48**: Production deployment with canary

### Phase 2: Enhanced Security (Week 1)
- **Day 3-4**: Implement request signing
- **Day 4-5**: Add comprehensive audit logging
- **Day 5-7**: Full security audit and penetration testing

### Phase 3: Long-term Improvements (Week 2-4)
- **Week 2**: Implement refresh token rotation
- **Week 3**: Add device fingerprinting
- **Week 4**: Deploy WAF rules and rate limiting

---

## 6. Communication Plan

### Internal Communication
1. **Immediate**: Security team and engineering leads
2. **Within 1 hour**: All backend engineers
3. **Within 4 hours**: Product and executive team

### External Communication
- **If no evidence of exploitation**: Fix silently, mention in next security update
- **If exploitation detected**: Immediate user notification, password reset required

---

## 7. Prevention Measures

### Code Review Checklist
- [ ] No userId extraction from headers
- [ ] All endpoints use getAuthContext()
- [ ] Ownership validation for resource modifications
- [ ] Rate limiting on sensitive operations
- [ ] Audit logging for all mutations

### Security Training
1. **Mandatory**: JWT security best practices
2. **Required reading**: OWASP Authentication Cheat Sheet
3. **Quarterly**: Security awareness training

### Automated Checks
```yaml
# GitHub Actions security check
- name: Security Audit
  run: |
    # Check for header-based auth
    ! grep -r "c.req.header('userId')" src/
    ! grep -r "request.headers.userId" src/

    # Ensure auth middleware is used
    grep -r "authMiddleware" src/index.ts
```

---

## Conclusion

This is a **CRITICAL SECURITY VULNERABILITY** that requires immediate action. The current implementation properly validates JWT tokens but then allows endpoints to accept userId from headers as a fallback, completely bypassing authentication.

**Immediate Action Required**:
1. Remove ALL header-based userId extraction
2. Enforce strict JWT authentication
3. Deploy fix within 24-48 hours
4. Monitor for exploitation attempts

**Risk if not addressed**: Complete platform compromise, user data breach, regulatory violations, and severe reputational damage.

---

**Document prepared by**: Security Audit Team
**Review required by**: CTO, Security Lead, Engineering Manager
**Fix ownership**: Backend Engineering Team
**Deadline**: IMMEDIATE - Within 48 hours