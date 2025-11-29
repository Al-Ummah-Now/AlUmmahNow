# Role Verification Testing Guide

## Overview
This document outlines how to test the role-based access control implementation in the admin-web application.

## Changes Made

### 1. Updated `/api/callback/route.ts`
- Added role extraction from OpenAuth token
- Implemented role verification using `hasAdminAccess()` function
- Added comprehensive logging for unauthorized access attempts
- Added role information to session storage
- Redirects to `/access-denied` if user lacks admin/moderator role

### 2. Updated `/lib/auth.ts`
- Added `requireAdminRole()` function for server-side role verification
- Updated `getAdminSession()` to extract and store role information from legacy cookies
- Role hierarchy: `super_admin` > `admin` > `moderator`

### 3. Updated `/(protected)/layout.tsx`
- Replaced `getAdminSession()` with `requireAdminRole()`
- Provides server-side role verification as a backup layer

### 4. Created `/access-denied/page.tsx`
- User-friendly error page for unauthorized access attempts
- Shows current user email and role (if available)
- Provides logout and "Go to Main Site" options

## Required Roles

Users must have one of the following roles to access the admin dashboard:
- `super_admin`
- `admin`
- `moderator`

## Test Scenarios

### Test 1: User with Admin Role (Success)
**Setup:**
1. Ensure test user has `admin` role in auth server

**Steps:**
1. Navigate to `http://localhost:3091/`
2. Click "Login" or navigate to `/login`
3. Complete OAuth authentication flow
4. Verify redirect to `/dashboard`
5. Verify session contains role information

**Expected Result:**
- User is successfully logged in
- Dashboard is accessible
- Log shows: "Admin login successful" with user details and role

**Log Example:**
```json
{
  "level": "info",
  "message": "Admin login successful",
  "data": {
    "userId": "user_123",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### Test 2: User with Moderator Role (Success)
**Setup:**
1. Ensure test user has `moderator` role in auth server

**Steps:**
1. Navigate to `http://localhost:3091/`
2. Complete authentication flow

**Expected Result:**
- User is successfully logged in
- Dashboard is accessible
- Session contains `role: "moderator"`

### Test 3: User with Super Admin Role (Success)
**Setup:**
1. Ensure test user has `super_admin` role in auth server

**Steps:**
1. Navigate to `http://localhost:3091/`
2. Complete authentication flow

**Expected Result:**
- User is successfully logged in
- Dashboard is accessible
- Session contains `role: "super_admin"`

### Test 4: User with Regular User Role (Denied)
**Setup:**
1. Ensure test user has only `user` role (no admin/moderator)

**Steps:**
1. Navigate to `http://localhost:3091/`
2. Complete authentication flow
3. Observe redirect behavior

**Expected Result:**
- User is redirected to `/access-denied`
- Access denied page shows:
  - Error icon and "Access Denied" heading
  - Message: "Admin or moderator role is required"
  - User's email address
  - Current role (if any)
  - "Log Out" button
  - "Go to Main Site" link
- Log shows unauthorized access attempt

**Log Example:**
```json
{
  "level": "warn",
  "message": "Unauthorized admin access attempt",
  "data": {
    "userId": "user_456",
    "email": "regular@example.com",
    "roles": ["user"]
  }
}
```

### Test 5: Unauthenticated User
**Setup:**
1. Clear all cookies/session
2. Or use incognito/private browsing mode

**Steps:**
1. Navigate directly to `http://localhost:3091/dashboard`

**Expected Result:**
- User is redirected to `/login`
- No access to protected routes

### Test 6: Legacy Cookie Migration
**Setup:**
1. Manually set legacy `access_token` and `refresh_token` cookies
2. Ensure user has admin role

**Steps:**
1. Navigate to `http://localhost:3091/dashboard`
2. Observe session migration

**Expected Result:**
- Legacy tokens are verified
- Role is extracted from token
- New session cookie is created with role information
- Dashboard is accessible

### Test 7: Direct Access to Protected Routes
**Setup:**
1. User with regular `user` role (no admin access)

**Steps:**
1. Complete authentication
2. Manually navigate to `http://localhost:3091/dashboard`
3. Try accessing `/translations` or other protected routes

**Expected Result:**
- Server-side `requireAdminRole()` check in layout catches unauthorized access
- User is redirected to `/access-denied`

### Test 8: Session with Missing Role
**Setup:**
1. Create a session with no role information (edge case)

**Steps:**
1. Navigate to protected routes

**Expected Result:**
- `hasAdminAccess(undefined)` returns `false`
- User is redirected to `/access-denied`

## Verification Checklist

- [ ] Type checking passes: `pnpm --filter @al-ummah/admin-web type-check`
- [ ] Linting passes: `pnpm --filter @al-ummah/admin-web lint`
- [ ] Admin users can access dashboard
- [ ] Moderator users can access dashboard
- [ ] Super admin users can access dashboard
- [ ] Regular users are denied access
- [ ] Unauthorized attempts are logged with `warn` level
- [ ] Successful logins are logged with `info` level
- [ ] Access denied page displays correctly
- [ ] Logout functionality works from access denied page
- [ ] Role information is stored in session
- [ ] Server-side protection works in protected layout
- [ ] Legacy cookie migration preserves role information

## Logging

All role-related events are logged using the centralized logger:

**View logs in real-time:**
```bash
# All admin-web logs
curl -N "http://localhost:3089/logs/stream/realtime?app=admin-web"

# Only warnings and errors (unauthorized attempts)
curl -N "http://localhost:3089/logs/stream/realtime?app=admin-web&level=warn"

# Using web viewer
# Open: http://localhost:3089/viewer/viewer.html
```

**Log Levels:**
- `info`: Successful admin logins
- `warn`: Unauthorized access attempts
- `error`: Token exchange/verification failures, callback errors

## Manual Testing Steps

1. **Start the development environment:**
   ```bash
   pnpm dev
   ```

2. **Open log viewer in separate terminal/browser:**
   ```bash
   curl -N "http://localhost:3089/logs/stream/realtime?app=admin-web"
   ```

3. **Test with admin user:**
   - Login with admin credentials
   - Verify dashboard access
   - Check logs for success message

4. **Test with regular user:**
   - Logout
   - Login with regular user credentials
   - Verify redirect to `/access-denied`
   - Check logs for warning message

5. **Test direct route access:**
   - While logged in as regular user
   - Navigate to `http://localhost:3091/translations`
   - Verify redirect to `/access-denied`

## Security Considerations

1. **Defense in Depth:**
   - Role check in callback route (primary)
   - Role check in protected layout (backup)
   - Token verification in `getAdminSession()` (base layer)

2. **Logging:**
   - All unauthorized attempts are logged
   - Logs include user ID, email, and roles
   - Enables security monitoring and auditing

3. **Clear Error Messages:**
   - Users see friendly error page
   - No sensitive information exposed
   - Clear guidance on next steps

## Known Issues

None at this time.

## Future Enhancements

1. Add email notifications for unauthorized access attempts
2. Implement rate limiting on login attempts
3. Add admin panel for role management
4. Create audit log viewer for security events
5. Add 2FA requirement for super admin role
