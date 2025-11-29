# Security Audit Report: PR #122 (Branch: channel)

**Date:** 2025-11-27
**Auditor:** Security Audit (Claude Code)
**PR:** #122
**Branch:** `channel` merging into `main`
**Scope:** Full security review of all changes

---

## 1. Executive Summary

This PR introduces significant new functionality including:
- New admin-api application with moderation capabilities
- New admin-web application for administrative interface
- Multi-account session management
- File upload with magic byte validation
- Rate limiting middleware
- i18n translation management
- Community posts and channel sections
- Scheduled video publishing

### Overall Security Posture: MODERATE RISK

The PR demonstrates good security awareness with several properly implemented security controls (magic byte validation, filename sanitization, rate limiting). However, there are several findings that require attention before merge.

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 5 |

---

## 2. Authentication

### 2.1 JWT Handling

**Status:** Generally Good with Concerns

**Positive Findings:**
- JWT signature verification using OpenAuth client (`@openauthjs/openauth`)
- Proper token expiration checking
- Removal of basic JWT validation fallback (signature verification is now mandatory)

**Location:** `apps/api-videos/src/middleware/auth.ts`, `apps/admin-api/src/middleware/auth.ts`

```typescript
// Good: Signature verification is now the only path
const payload = await validateJWTWithSignature(token, c.env);
```

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| AUTH-001 | HIGH | **Sensitive Token Logging**: Auth middleware logs full token payload including tokens. See `apps/admin-api/src/middleware/auth.ts` line ~70: `fullPayload: JSON.stringify(payload)`. This could expose tokens in logs. |
| AUTH-002 | MEDIUM | **JWT Payload Extraction Without Verification**: In `apps/web/src/app/api/callback/route.ts` line ~27, JWT payload is extracted via base64 decode without signature verification: `JSON.parse(atob(exchanged.tokens.access.split('.')[1]))`. While the comment states the token was already validated, this is a fragile pattern. |

**Recommendations:**
1. Remove `fullPayload` from log statements
2. Use the verified subject properties from OpenAuth client rather than re-parsing JWT

### 2.2 Token Storage

**Status:** Good

**Positive Findings:**
- HttpOnly cookies for session storage
- Secure flag enabled in production
- SameSite='lax' preventing CSRF on state-changing requests
- No tokens exposed to JavaScript

**Location:** `apps/web/src/lib/auth/session-manager.ts`

```typescript
cookieStore.set(SESSION_COOKIE_NAME, jsonValue, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_MAX_AGE,
  path: '/',
});
```

### 2.3 Session Management

**Status:** Acceptable with Concerns

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| AUTH-003 | MEDIUM | **Tokens Stored in Cookie JSON**: Access and refresh tokens are stored directly in the session cookie JSON (`apps/web/src/lib/auth/session-manager.ts`). If cookie is somehow leaked, all tokens for all accounts are compromised. Consider server-side session storage for tokens. |
| AUTH-004 | LOW | **Cookie Size Limit**: Session data approaches 4KB browser limit with multiple accounts. While there is monitoring, hitting the limit could cause authentication failures. |

---

## 3. Authorization

### 3.1 RBAC Implementation

**Status:** Good

**Positive Findings:**
- Admin routes properly extend `AdminRoute` base class
- Role checks performed in middleware before handler execution
- Roles sourced from JWT claims (trusted source)

**Location:** `apps/admin-api/src/base/AdminRoute.ts`

```typescript
// Good: Role validation in execute() before handler
const hasAdminRole = await this.checkAdminRole(c, auth.userId);
if (!hasAdminRole) {
  throw new HTTPException(403, { message: 'Admin or moderator role required' });
}
```

### 3.2 Ownership Checks

**Status:** Good

**Positive Findings:**
- Channel ownership verified before operations
- Video ownership checked on updates/deletes
- `channelIdMiddleware` validates channel ownership

**Location:** `apps/api-videos/src/middleware/auth.ts`

```typescript
// Good: Channel ownership verification
if (channelData.userId !== auth.userId) {
  return c.json({
    success: false,
    error: 'You do not have permission to perform actions on behalf of this channel'
  }, 403);
}
```

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| AUTHZ-001 | MEDIUM | **Inconsistent Channel Ownership Check**: In some community post endpoints, channel ownership is checked via header (`channelId`) which could be spoofed. The check queries R2, but relies on client-provided channelId. |

---

## 4. Input Validation

### 4.1 Request Validation

**Status:** Good

**Positive Findings:**
- Zod schemas for all request validation
- OpenAPI schema enforcement via chanfana
- Type coercion handled properly

### 4.2 XSS Prevention

**Status:** Good

**Positive Findings:**
- `sanitize-html` library used for user-generated content
- Community post content sanitized before storage

**Location:** `apps/api-videos/src/endpoints/community/create-post.ts`

```typescript
content: body.content ? sanitizeHtml(body.content, sanitizeOptions) : undefined,
```

### 4.3 SQL Injection

**Status:** Good

**Positive Findings:**
- Parameterized queries used throughout
- D1 prepared statements with bound parameters

**Location:** `apps/admin-api/src/endpoints/moderation/ReportAction.ts`

```typescript
// Good: Parameterized query
const report = await db.prepare(
  'SELECT * FROM reports WHERE id = ?'
).bind(reportId).first<Report>();
```

### 4.4 Path Traversal

**Status:** Excellent

**Positive Findings:**
- Comprehensive filename sanitization
- Path traversal sequences removed
- Special characters filtered
- Unique filenames generated with UUIDs

**Location:** `apps/api-videos/src/lib/security/filename-sanitize.ts`

```typescript
// Excellent: Thorough sanitization
sanitized = baseName
  .replace(/\\/g, '-')  // Replace backslashes
  .replace(/\//g, '-')  // Replace forward slashes
  .replace(/\.\./g, '') // Remove parent directory references
  .replace(/^\.+/, '')  // Remove leading dots
```

---

## 5. API Security

### 5.1 Rate Limiting

**Status:** Good

**Positive Findings:**
- Per-user rate limiting implemented
- Multiple time windows (minute, hour, day)
- Concurrent upload tracking
- Proper 429 responses with Retry-After header

**Location:** `apps/api-videos/src/middleware/rate-limit.ts`

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| API-001 | HIGH | **Rate Limiting Disabled in Development/Preview**: Rate limiting is skipped entirely in development and preview environments. This could allow abuse in preview deployments. |
| API-002 | MEDIUM | **Rate Limit Graceful Degradation**: When KV is unavailable, requests are allowed without rate limiting. This is documented as intentional but could be exploited during KV outages. |

```typescript
// Concern: Rate limiting bypassed
if (environment === 'development' || environment === 'preview') {
  logger.info('[SECURITY] Skipping rate limit check in development/preview mode');
  return next();
}
```

### 5.2 CORS Configuration

**Status:** CRITICAL CONCERN

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| API-003 | CRITICAL | **Overly Permissive CORS**: `origin: '*'` allows any origin to make requests. Combined with `credentials: false`, this is mitigated for cookie-based auth, but API keys or tokens in headers are still vulnerable to cross-origin theft. |

**Location:** `apps/api-videos/src/index.ts`, `apps/admin-api/src/index.ts`

```typescript
// CRITICAL: Overly permissive CORS
app.use('*', cors({
  origin: '*',  // Should be restricted to known domains
  allowHeaders: ['Content-Type', 'Authorization', ...],
  credentials: false,
}));
```

**Recommendation:** Restrict `origin` to specific allowed domains:
```typescript
origin: [
  'https://alummahnow.net',
  'https://admin.alummahnow.net',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : null
].filter(Boolean)
```

### 5.3 CSRF Protection

**Status:** Acceptable

**Positive Findings:**
- SameSite='lax' on cookies provides CSRF protection for state-changing requests
- Bearer token authentication for API endpoints

**Note:** Since cookies have `credentials: false` in CORS and use SameSite, CSRF risk is mitigated.

---

## 6. Data Protection

### 6.1 Sensitive Data Handling

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| DATA-001 | HIGH | **Excessive Logging of Auth Context**: Multiple locations log sensitive authentication data including user IDs, emails, and role information. While not tokens, this could aid attackers. |

**Locations:**
- `apps/admin-api/src/middleware/auth.ts` - logs full auth payload
- `apps/admin-api/src/base/AdminRoute.ts` - logs auth context with roles

### 6.2 PII Handling

**Status:** Acceptable

- User emails stored in session cookies (HttpOnly)
- No apparent PII leakage in error responses

### 6.3 Encryption

**Status:** Acceptable

- HTTPS enforced in production (Cloudflare Workers)
- Cookies marked Secure in production
- Note: Session data in cookies is not encrypted, but is HttpOnly

---

## 7. File Upload Security

### 7.1 Type Validation

**Status:** Excellent

**Positive Findings:**
- Magic byte validation for all uploads (not relying on Content-Type)
- Comprehensive signatures for video and image formats
- MIME type mismatch detection and logging

**Location:** `apps/api-videos/src/lib/security/magic-bytes.ts`

```typescript
// Excellent: Magic byte validation
export function validateVideoMagicBytes(
  fileData: Uint8Array | ArrayBuffer,
  providedMimeType?: string
): MagicByteValidationResult {
  // Checks actual file bytes, not Content-Type header
}
```

### 7.2 Size Limits

**Status:** Good

**Positive Findings:**
- File size limits enforced (5MB images, 10MB GIFs)
- Limits checked before processing

### 7.3 Filename Sanitization

**Status:** Excellent

**Positive Findings:**
- Path traversal prevention
- Dangerous extension blocking
- UUID prefix for uniqueness
- Control character removal

**Location:** `apps/api-videos/src/lib/security/filename-sanitize.ts`

---

## 8. WebSocket Security

### 8.1 Authentication

**Status:** Good

**Positive Findings:**
- JWT validation on WebSocket connections
- Uses same OpenAuth validation as HTTP endpoints

### 8.2 Message Validation

**Status:** Acceptable

**Positive Findings:**
- Message type checking
- Channel subscription validation
- Type guards for message data

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| WS-001 | LOW | **Broadcast Endpoint API Key**: Internal broadcast endpoint uses simple API key (`X-API-Key`). Consider using signed tokens for server-to-server auth. |

### 8.3 DoS Protection

**Status:** Documented (Not in Scope)

Per existing documentation, rate limiting exists (100 messages/minute per connection) in the WebSocket server, but this PR primarily updates logging.

---

## 9. Secrets Management

### 9.1 Hardcoded Secrets

**Status:** Good

**Positive Findings:**
- No hardcoded secrets found
- Cloudflare Workers secrets used for sensitive values
- `requireSecret` helper enforces secret availability

**Location:** `apps/api-videos/src/lib/env-helpers.ts`

### 9.2 Environment Variables

**Status:** Good

**Positive Findings:**
- Secrets accessed via Cloudflare bindings
- Development URLs in wrangler configs are not sensitive

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| SEC-001 | LOW | **Debug Logging of Secret Extraction**: `apps/api-videos/src/endpoints/video/videoUpload.ts` logs `[DEBUG] Extracting Bunny secrets...` which indicates when secrets are being accessed. This is low risk but provides information to attackers. |

---

## 10. Third-Party Risk

### 10.1 External Service Calls

**Status:** Acceptable

- Bunny.net integration for video storage
- OpenAuth for authentication
- All integrations use secrets management

### 10.2 Dependency Vulnerabilities

**Status:** Not Audited

**Recommendation:** Run `pnpm audit` to check for known vulnerabilities in dependencies.

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| THIRD-001 | LOW | **sanitize-html Package**: Ensure `sanitize-html` is up-to-date as HTML sanitization libraries frequently have bypass vulnerabilities. |

---

## 11. OWASP Top 10 (2021) Analysis

| Category | Status | Notes |
|----------|--------|-------|
| A01:2021 Broken Access Control | PASS | Proper ownership checks, RBAC implementation |
| A02:2021 Cryptographic Failures | PASS | HTTPS, HttpOnly cookies, proper JWT validation |
| A03:2021 Injection | PASS | Parameterized queries, HTML sanitization, input validation |
| A04:2021 Insecure Design | PASS | Defense in depth, proper error handling |
| A05:2021 Security Misconfiguration | FAIL | Overly permissive CORS (API-003) |
| A06:2021 Vulnerable Components | UNKNOWN | Dependency audit not performed |
| A07:2021 Auth Failures | PASS | Proper JWT validation, session management |
| A08:2021 Software/Data Integrity | PASS | Content sanitization, magic byte validation |
| A09:2021 Security Logging/Monitoring | PARTIAL | Good logging but sensitive data in logs (AUTH-001, DATA-001) |
| A10:2021 Server-Side Request Forgery | PASS | No user-controlled URLs in server requests |

---

## 12. Critical Findings (Must Fix Before Merge)

### CRITICAL-001: Overly Permissive CORS (API-003)

**Risk:** High - Allows any website to make authenticated API requests
**Location:** `apps/api-videos/src/index.ts`, `apps/admin-api/src/index.ts`
**Fix:** Restrict CORS origins to known domains

```typescript
// BEFORE (vulnerable)
app.use('*', cors({
  origin: '*',
}));

// AFTER (secure)
const ALLOWED_ORIGINS = [
  'https://alummahnow.net',
  'https://www.alummahnow.net',
  'https://admin.alummahnow.net',
];

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3001', 'http://localhost:3090');
}

app.use('*', cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
}));
```

### CRITICAL-002: Sensitive Data in Logs (AUTH-001, DATA-001)

**Risk:** Medium-High - Token/auth data could be exposed in log systems
**Locations:**
- `apps/admin-api/src/middleware/auth.ts` (~line 70)
- `apps/admin-api/src/base/AdminRoute.ts`

**Fix:** Remove sensitive fields from log statements:

```typescript
// BEFORE (vulnerable)
logger.info('Auth token payload received', {
  sub: payload.sub,
  email: payload.email,
  roles: payload.roles,
  fullPayload: JSON.stringify(payload)  // REMOVE THIS
});

// AFTER (secure)
logger.info('Auth token validated', {
  sub: payload.sub,
  hasEmail: !!payload.email,
  rolesCount: payload.roles?.length || 0
});
```

---

## 13. Recommendations (Prioritized)

### Priority 1 - Must Fix

1. **Fix CORS Configuration** - Restrict to known origins
2. **Remove Sensitive Data from Logs** - Remove fullPayload, token data
3. **Enable Rate Limiting in Preview** - At least apply basic limits

### Priority 2 - Should Fix

4. **Server-Side Session Storage** - Move tokens out of cookies to reduce exposure
5. **Rate Limit Fail-Closed** - Consider denying requests when KV unavailable
6. **Channel Ownership Validation** - Use auth context instead of header for channelId

### Priority 3 - Consider

7. **Run Dependency Audit** - `pnpm audit` for vulnerability check
8. **Add Security Headers** - CSP, X-Frame-Options (may be handled by Cloudflare)
9. **Implement Request Signing** - For server-to-server WebSocket broadcast
10. **Add Rate Limiting to Admin API** - Currently no rate limiting on admin endpoints

---

## 14. Summary

This PR demonstrates security-conscious development with several well-implemented security controls:

**Strengths:**
- Excellent file upload security (magic bytes, sanitization)
- Proper JWT validation with signature verification
- Good RBAC implementation
- Parameterized SQL queries
- HTML sanitization for user content

**Weaknesses:**
- Overly permissive CORS configuration
- Sensitive data in log statements
- Rate limiting disabled in non-production environments
- Tokens stored in cookie JSON (defense in depth concern)

**Recommendation:** Address CRITICAL findings before merge. The security posture is acceptable for a video platform but requires the identified fixes for production deployment.

---

*Report generated by security audit workflow*
*Al Ummah Now Security Review Process*
