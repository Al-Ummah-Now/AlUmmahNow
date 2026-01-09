# Multi-Account & Multi-Channel Migration Guide

## Overview

This guide covers the migration from the current single-account system to the new multi-account and multi-channel architecture.

## Architecture Changes

### Before (Single Account)
```
Cookies:
- access_token: JWT token
- refresh_token: Refresh token

Auth Context:
- userId: Single user ID
- accessToken: Single token
```

### After (Multi-Account)
```
Cookies:
- al_ummah_session: Encrypted session with multiple accounts

Auth Context:
- userId: Active user ID
- channelId: Active channel ID (NEW)
- accessToken: Active user's token
```

## Migration Steps

### Phase 1: Install Dependencies (Day 1)

```bash
# Add iron-session for cookie encryption
pnpm --filter @al-ummah/web add iron-session
```

### Phase 2: Deploy Foundation (Day 2-3)

1. **Deploy new files without breaking changes:**
   - `/lib/auth/session-manager.ts` - New session management
   - `/lib/api/server-auth-v2.ts` - New auth context (parallel to old)
   - `/lib/actions/multi-account.ts` - New server actions
   - `/hooks/useMultiAccount.tsx` - New React hook

2. **Add environment variable:**
   ```env
   SESSION_SECRET=your-complex-password-at-least-32-characters-long
   ```

3. **Test in staging:**
   - Existing users continue using old system
   - New code is deployed but inactive

### Phase 3: Enable Dual Mode (Week 1)

1. **Update getServerAuthContext to support both systems:**

```typescript
// apps/web/src/lib/api/server-auth.ts
'use server';

import { cookies } from 'next/headers';
import { authenticated } from '@/lib/actions';
import { AuthContext } from './api-client';
import { SessionManager } from '../auth/session-manager';

export async function getServerAuthContext(): Promise<AuthContext | null> {
  // Try new session first
  const session = await SessionManager.getActiveSession();
  if (session) {
    return {
      userId: session.userId,
      accessToken: session.accessToken,
      channelId: session.channelId, // New field, optional
    };
  }

  // Fall back to legacy
  const auth = await authenticated();
  if (!auth) {
    return null;
  }

  const userId = auth.properties.id;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token');

  if (!accessToken?.value) {
    return null;
  }

  // Auto-migrate to new system
  await SessionManager.addAccount(
    {
      accessToken: accessToken.value,
      refreshToken: cookieStore.get('refresh_token')?.value || '',
    },
    {
      id: userId,
      email: auth.properties.email,
      displayName: auth.properties.displayName || auth.properties.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  );

  return {
    userId,
    accessToken: accessToken.value
  };
}
```

2. **Deploy and monitor:**
   - Users are gradually migrated as they use the app
   - Both cookie formats work simultaneously
   - Monitor for errors

### Phase 4: Add UI Components (Week 2)

1. **Add MultiAccountProvider to root layout:**

```tsx
// apps/web/src/app/[locale]/layout.tsx
import { MultiAccountProvider } from '@/hooks/useMultiAccount';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <MultiAccountProvider>
          {/* existing layout */}
          {children}
        </MultiAccountProvider>
      </body>
    </html>
  );
}
```

2. **Add account/channel switchers to header:**

```tsx
// apps/web/src/components/Header.tsx
import { AccountSwitcher } from './AccountSwitcher';
import { ChannelSelector } from './ChannelSelector';

export function Header() {
  return (
    <header>
      {/* existing header content */}
      <div className="flex items-center gap-4">
        <ChannelSelector />
        <AccountSwitcher />
      </div>
    </header>
  );
}
```

3. **Test features:**
   - Account switching
   - Channel selection
   - Multiple logins

### Phase 5: Update API Clients (Week 3)

1. **API clients automatically get channelId from context**
   - No changes needed to API client files
   - `getServerAuthContext()` now returns channelId
   - API backend receives channelId in headers

2. **Update channel-specific operations:**

```typescript
// Before: Manual channel ID
await VideosAPI.create(data, { channelId: 'manual-id' });

// After: Automatic from context
await VideosAPI.create(data); // Uses active channel
```

### Phase 6: Cleanup (Week 4)

1. **After 30 days, remove legacy support:**

```typescript
// Remove from server-auth.ts
export async function getServerAuthContext(): Promise<AuthContext | null> {
  // Only use new session manager
  const session = await SessionManager.getActiveSession();

  if (!session) {
    return null;
  }

  return {
    userId: session.userId,
    accessToken: session.accessToken,
    channelId: session.channelId,
  };
}
```

2. **Remove legacy cookie cleanup:**

```typescript
// One-time cleanup script
export async function cleanupLegacyCookies() {
  const cookieStore = await cookies();
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
}
```

## Testing Checklist

### Unit Tests
- [ ] SessionManager CRUD operations
- [ ] Cookie encryption/decryption
- [ ] Token refresh logic
- [ ] Migration from legacy cookies

### Integration Tests
- [ ] Login with first account
- [ ] Add second account
- [ ] Switch between accounts
- [ ] Select different channels
- [ ] API calls with correct context
- [ ] Logout single account
- [ ] Logout all accounts

### E2E Tests
- [ ] Complete multi-account flow
- [ ] Channel creation and switching
- [ ] Cross-account data isolation
- [ ] Session persistence across refreshes

## Rollback Plan

If issues occur, rollback is simple:

1. **Feature flag in environment:**
   ```env
   ENABLE_MULTI_ACCOUNT=false
   ```

2. **Conditional in server-auth.ts:**
   ```typescript
   if (process.env.ENABLE_MULTI_ACCOUNT === 'false') {
     // Use legacy implementation
     return getLegacyAuthContext();
   }
   ```

3. **Hide UI components:**
   ```tsx
   {process.env.NEXT_PUBLIC_ENABLE_MULTI_ACCOUNT !== 'false' && (
     <>
       <AccountSwitcher />
       <ChannelSelector />
     </>
   )}
   ```

## Common Issues & Solutions

### Issue: Cookie size exceeded
**Solution:** Store minimal data, use compression:
```typescript
const compressed = zlib.gzipSync(JSON.stringify(data));
const sealed = await sealData(compressed, { password });
```

### Issue: Token expired for inactive account
**Solution:** Background refresh for all accounts:
```typescript
// Run every 30 minutes
setInterval(async () => {
  await SessionManager.refreshAllTokens();
}, 30 * 60 * 1000);
```

### Issue: Channel not found after switching account
**Solution:** Load channels on account switch:
```typescript
await SessionManager.setActiveAccount(userId);
await SessionManager.loadUserChannels(userId);
```

## Monitoring

Track these metrics during migration:

1. **Migration Progress:**
   - Users with new session format
   - Users still on legacy format
   - Failed migrations

2. **Feature Usage:**
   - Multi-account adoption rate
   - Average accounts per user
   - Channel switching frequency

3. **Performance:**
   - Cookie size distribution
   - Auth context load time
   - Token refresh success rate

4. **Errors:**
   - Session corruption
   - Token refresh failures
   - Cookie encryption errors

## Security Considerations

1. **Cookie Encryption:**
   - Use strong SESSION_SECRET (32+ characters)
   - Rotate secret periodically
   - Never expose raw session data

2. **Token Isolation:**
   - Each account's tokens are isolated
   - No cross-account token access
   - Validate channel ownership

3. **Session Management:**
   - Auto-cleanup after 30 days inactive
   - Re-authentication for sensitive actions
   - Audit logging for account switches

## Support & Troubleshooting

For issues during migration:

1. Check logs for migration errors
2. Verify SESSION_SECRET is set
3. Ensure cookies are not blocked
4. Test in incognito mode
5. Clear browser cookies if corrupted

## Timeline Summary

- **Week 1:** Deploy foundation, enable dual mode
- **Week 2:** Add UI components, test features
- **Week 3:** Update API clients, full testing
- **Week 4:** Monitor, optimize, prepare cleanup
- **Day 30+:** Remove legacy support

## Success Criteria

Migration is complete when:
- ✅ All active users migrated to new system
- ✅ No legacy cookies in production
- ✅ Multi-account UI deployed and working
- ✅ Channel switching functional
- ✅ Zero increase in auth-related errors
- ✅ Performance metrics stable or improved