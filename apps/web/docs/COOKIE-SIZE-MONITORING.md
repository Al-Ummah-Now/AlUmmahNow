# Cookie Size Monitoring

## Overview

The SessionManager includes built-in cookie size monitoring to prevent exceeding browser limits and help identify issues before they occur.

## Browser Cookie Limits

- **Maximum Size**: 4KB (4096 bytes) per cookie
- **Warning Threshold**: 3KB (75% of limit)
- **Total per Domain**: ~50 cookies (varies by browser)

## Features

### 1. Automatic Size Checking

Every time the session is saved, the cookie size is automatically checked:

```typescript
// Happens automatically on every session update
await SessionManager.setSessionData(sessionData);
```

**Console Output:**
```
[SessionManager] Cookie size: 1.23 KB (30.0% of 4KB limit) | Accounts: 2
```

### 2. Warning at 75% (3KB)

When the cookie reaches 3KB (75% of the limit):

```
[SessionManager] ⚠️  Cookie size warning: 3.12 KB / 4 KB (76.0%)
Consider reducing data or implementing server-side session storage.
Current accounts: 5
```

### 3. Error at 4KB

If the cookie exceeds 4KB, an error is thrown with detailed breakdown:

```
[SessionManager] 🚨 Cookie size EXCEEDED: 4.25 KB / 4 KB
Browser may reject this cookie!
Size breakdown: {
  account_user1: "0.85 KB",
  account_user2: "0.92 KB",
  account_user3: "0.88 KB",
  account_user4: "0.91 KB",
  account_user5: "0.87 KB",
  metadata: "0.02 KB"
}

Error: Session cookie size (4.25 KB) exceeds browser limit (4 KB).
Remove accounts or reduce data. Current accounts: 5
```

## Programmatic Access

### Get Cookie Size Info

```typescript
import { getSessionCookieSize } from '@/lib/actions/multi-account';

const sizeInfo = await getSessionCookieSize();

console.log(sizeInfo);
// {
//   sizeBytes: 1234,
//   sizeKB: "1.21",
//   usagePercent: "30.1",
//   accountCount: 2,
//   isNearLimit: false,
//   isOverLimit: false,
//   breakdown: {
//     account_user1: "0.60 KB",
//     account_user2: "0.59 KB",
//     metadata: "0.02 KB"
//   }
// }
```

### Server-Side Access

```typescript
import { SessionManager } from '@/lib/auth/session-manager';

const sizeInfo = await SessionManager.getCookieSizeInfo();
```

## UI Component (Development Only)

A visual monitoring component is available for development:

```tsx
import { CookieSizeMonitor } from '@/components/CookieSizeMonitor';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {/* Only visible in NODE_ENV=development */}
        <CookieSizeMonitor />
      </body>
    </html>
  );
}
```

### Component Features

- **Auto-refresh**: Updates every 5 seconds
- **Color-coded status**:
  - 🟢 Green: < 75% (healthy)
  - 🟡 Yellow: 75-99% (warning)
  - 🔴 Red: 100%+ (critical)
- **Expandable details**: Click to see breakdown
- **Progress bar**: Visual size indicator
- **Dev-only**: Automatically hidden in production

### Screenshot

Compact view:
```
✓ Cookie: 1.23 KB (30.0%) ▶
```

Expanded view:
```
Session Cookie Size
Size:      1.23 KB
Usage:     30.0% of 4 KB
Accounts:  2

[Progress Bar: ▓▓▓░░░░░░░]

Size Breakdown ▼
  account_user1: 0.60 KB
  account_user2: 0.59 KB
  metadata:      0.02 KB
```

## Size Optimization Tips

### 1. Reduce Token Size

JWT tokens are the largest part of the cookie. Work with your auth provider to:
- Remove unnecessary claims
- Use shorter user IDs
- Avoid embedding large payloads

### 2. Limit Accounts

Set `MAX_ACCOUNTS` to a reasonable limit:

```typescript
const MAX_ACCOUNTS = 5; // Recommended: 3-5 accounts
```

### 3. Reduce Channel Data

Only store essential channel info:

```typescript
// ❌ Bad: Store everything
account.channels = fullChannelObjects;

// ✅ Good: Store only IDs and names
account.channels = channels.map(ch => ({
  id: ch.id,
  name: ch.name,
  isMain: ch.isMain,
}));
```

### 4. Server-Side Storage (Future)

For apps with many accounts, consider server-side session storage:
- Store session in Redis/Database
- Store only session ID in cookie
- Session ID is much smaller (~36 bytes)

## Typical Sizes

Based on typical data:

| Accounts | Channels/Account | Estimated Size | Status |
|----------|------------------|----------------|--------|
| 1        | 5                | ~0.8 KB        | ✅ Safe |
| 2        | 5                | ~1.4 KB        | ✅ Safe |
| 3        | 10               | ~2.1 KB        | ✅ Safe |
| 5        | 5                | ~2.8 KB        | ⚠️ Warning |
| 5        | 10               | ~3.5 KB        | ⚠️ Warning |
| 8        | 10               | ~5.0 KB        | 🚨 Error |

**Note**: Actual sizes depend on:
- JWT token size (~400-800 bytes)
- Avatar URLs (if present)
- Display name length
- Channel count per user

## Monitoring in Production

### Server-Side Logging

All cookie size updates are logged automatically:

```typescript
// Every setSessionData() call logs:
console.log(`[SessionManager] Cookie size: X.XX KB (XX.X% of 4KB limit) | Accounts: N`);
```

Monitor these logs to detect size issues early.

### Analytics

Track cookie size metrics:

```typescript
// Send to analytics
const sizeInfo = await getSessionCookieSize();
analytics.track('session_cookie_size', {
  sizeKB: sizeInfo.sizeKB,
  usagePercent: sizeInfo.usagePercent,
  accountCount: sizeInfo.accountCount,
});
```

## Troubleshooting

### "Cookie size EXCEEDED" Error

**Cause**: Session cookie is > 4KB

**Solutions**:
1. Remove unused accounts: `removeUserAccount(userId)`
2. Reduce channel count per user
3. Clear and re-login: `clearAllSessions()`
4. Contact support if issue persists

### Cookie Not Persisting

**Symptoms**: User logged out on refresh

**Possible Cause**: Cookie rejected by browser due to size

**Check**:
```typescript
const sizeInfo = await getSessionCookieSize();
console.log('Cookie size:', sizeInfo);
```

**Fix**: Reduce cookie size (see optimization tips)

## API Reference

### `getCookieSizeInfo()`

Returns detailed cookie size information.

**Returns**:
```typescript
{
  sizeBytes: number;        // Raw byte size
  sizeKB: string;           // Size in KB (formatted)
  usagePercent: string;     // Percentage of 4KB limit
  accountCount: number;     // Number of accounts
  isNearLimit: boolean;     // True if >= 3KB
  isOverLimit: boolean;     // True if >= 4KB
  breakdown: {              // Size per account
    account_xxx: string;
    metadata: string;
  }
}
```

**Usage**:
```typescript
const info = await SessionManager.getCookieSizeInfo();
if (info?.isNearLimit) {
  console.warn('Cookie approaching limit!');
}
```

### Constants

```typescript
SESSION_COOKIE_NAME = 'al_ummah_session'
SESSION_MAX_AGE = 30 * 24 * 60 * 60        // 30 days
MAX_ACCOUNTS = 10                           // Max accounts
COOKIE_SIZE_WARNING_THRESHOLD = 3072       // 3KB warning
COOKIE_SIZE_MAX = 4096                     // 4KB error
```

## Best Practices

1. ✅ Monitor cookie size in development with `<CookieSizeMonitor />`
2. ✅ Set reasonable `MAX_ACCOUNTS` limit (3-5 recommended)
3. ✅ Test with maximum expected accounts/channels
4. ✅ Log cookie size metrics in production
5. ✅ Provide UI to remove old accounts
6. ✅ Consider server-side sessions if exceeding limits regularly
7. ❌ Don't store large objects in session
8. ❌ Don't ignore size warnings in development
