# ADR-001: Multi-Account and Multi-Channel Architecture

## Status
Proposed

## Context
The Al Ummah Now platform needs to support multiple user accounts logged in simultaneously (like Gmail's account switcher) and multiple channels per user account (like YouTube's channel switching). Currently, the application only supports single-user authentication with no channel selection mechanism.

### Current Limitations
1. Single JWT token stored in `access_token` cookie
2. No mechanism for tracking multiple authenticated sessions
3. No way to select active channel for API operations
4. Server actions only aware of single authenticated user

### Requirements
- Support multiple simultaneous user logins (account switching)
- Support multiple channels per user (channel switching)
- Server actions must know which user+channel is currently selected
- Must work with HttpOnly cookies (can't access from client JavaScript)
- Should be secure and follow Next.js 15 best practices
- Minimize breaking changes to existing API client code

## Decision

We will implement a **Session Manager architecture** using encrypted HttpOnly cookies with the following structure:

### 1. Multi-Account Cookie Structure
```typescript
// Main session cookie (encrypted JSON)
"al_ummah_session": {
  activeUserId: string,          // Currently selected user
  activeChannelId: string | null, // Currently selected channel for active user
  accounts: {
    [userId: string]: {
      accessToken: string,
      refreshToken: string,
      email: string,
      displayName: string,
      channels: Channel[],       // User's channels loaded from API
      activeChannelId: string | null, // Last selected channel for this user
      lastActivity: number,      // Unix timestamp for session management
    }
  }
}

// Legacy cookies (kept for backward compatibility during migration)
"access_token": string  // Will be deprecated
"refresh_token": string // Will be deprecated
```

### 2. Server-Side Architecture Components

#### Session Manager Service
```typescript
// apps/web/src/lib/auth/session-manager.ts
class SessionManager {
  // Core operations
  async addAccount(tokens: AuthTokens, userInfo: User): Promise<void>
  async removeAccount(userId: string): Promise<void>
  async setActiveAccount(userId: string): Promise<void>
  async setActiveChannel(channelId: string): Promise<void>

  // Getters
  async getActiveSession(): Promise<SessionContext | null>
  async getAllSessions(): Promise<SessionInfo[]>
  async getSessionForUser(userId: string): Promise<UserSession | null>

  // Token management
  async refreshTokenForUser(userId: string): Promise<boolean>
  async refreshAllTokens(): Promise<void>

  // Cleanup
  async cleanupExpiredSessions(): Promise<void>
}
```

#### Enhanced Auth Context
```typescript
// apps/web/src/lib/api/server-auth.ts
export interface SessionContext {
  // Active user info
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  displayName: string;

  // Active channel info (if selected)
  channelId?: string;
  channelName?: string;

  // Available accounts and channels
  availableAccounts: AccountInfo[];
  availableChannels: Channel[];
}
```

### 3. Server Actions for Account/Channel Management

```typescript
// apps/web/src/lib/actions/multi-account.ts
'use server';

// Account management
export async function addUserAccount(code: string): Promise<void>
export async function switchUserAccount(userId: string): Promise<void>
export async function removeUserAccount(userId: string): Promise<void>
export async function listUserAccounts(): Promise<AccountInfo[]>

// Channel management
export async function switchChannel(channelId: string): Promise<void>
export async function getUserChannels(userId?: string): Promise<Channel[]>
export async function createChannelForActiveUser(data: ChannelCreateRequest): Promise<Channel>
```

### 4. Client-Side Hooks and Context

```typescript
// apps/web/src/hooks/useMultiAccount.tsx
export function useMultiAccount() {
  const accounts = useAccounts();          // All logged-in accounts
  const activeAccount = useActiveAccount(); // Currently selected account
  const channels = useChannels();          // Channels for active account
  const activeChannel = useActiveChannel(); // Currently selected channel

  return {
    // State
    accounts,
    activeAccount,
    channels,
    activeChannel,

    // Actions (call server actions)
    addAccount: async (code: string) => {},
    switchAccount: async (userId: string) => {},
    removeAccount: async (userId: string) => {},
    switchChannel: async (channelId: string) => {},
  };
}
```

### 5. Cookie Encryption Strategy

Use Next.js built-in encryption with iron-session or jose:
```typescript
// apps/web/src/lib/auth/cookie-encryption.ts
import { sealData, unsealData } from 'iron-session';

const PASSWORD = process.env.SESSION_SECRET!;

export async function encryptSession(data: SessionData): Promise<string> {
  return sealData(data, { password: PASSWORD });
}

export async function decryptSession(sealed: string): Promise<SessionData> {
  return unsealData(sealed, { password: PASSWORD });
}
```

## Consequences

### Positive
1. **User Experience**: Seamless switching between multiple accounts and channels
2. **Security**: All sensitive data in encrypted HttpOnly cookies
3. **Performance**: No additional API calls for auth context (cached in cookies)
4. **Compatibility**: Existing API clients work without modification
5. **Scalability**: Can support unlimited accounts/channels per browser
6. **Session Management**: Independent token refresh per account

### Negative
1. **Cookie Size**: Larger cookies with multiple accounts (mitigated by compression)
2. **Complexity**: More complex session management logic
3. **Migration**: Requires careful migration from existing single-account system

### Tradeoffs & Mitigations
- **Cookie Size Limit (4KB)**: Store minimal data, load full profiles on-demand
- **Token Expiry**: Background refresh for all accounts to prevent surprises
- **Security**: Regular session cleanup, activity tracking, re-authentication for sensitive actions

## Alternatives Considered

### 1. IndexedDB Storage
- **Rejected**: Can't be accessed from server actions, not secure for tokens

### 2. Multiple Cookie Approach
- **Rejected**: Complex cookie management, hitting browser limits quickly

### 3. Server-Side Session Store (Redis/KV)
- **Rejected**: Adds infrastructure dependency, latency, not edge-optimized

### 4. URL-Based Account/Channel Selection
- **Rejected**: Poor UX, security concerns with tokens in URLs

## Implementation Notes

### Phase 1: Foundation (Week 1)
1. Implement SessionManager service
2. Add cookie encryption utilities
3. Create migration utilities for existing users
4. Update getServerAuthContext() to use new structure

### Phase 2: Account Management (Week 2)
1. Implement multi-account server actions
2. Create account switcher UI component
3. Add "Add Account" flow
4. Test with multiple accounts

### Phase 3: Channel Management (Week 3)
1. Implement channel switching server actions
2. Create channel selector UI component
3. Update API clients to include channelId
4. Test channel-specific operations

### Phase 4: Migration & Cleanup (Week 4)
1. Deploy with backward compatibility
2. Migrate existing users progressively
3. Monitor and fix issues
4. Remove legacy cookie support

### Security Considerations

1. **Token Isolation**: Each account's tokens are isolated
2. **CSRF Protection**: Use Next.js built-in CSRF tokens
3. **XSS Prevention**: HttpOnly cookies, no client-side token access
4. **Session Hijacking**: Tie sessions to user agent/IP (optional)
5. **Token Refresh**: Automatic refresh prevents expired token usage
6. **Audit Logging**: Track all account/channel switches

### Migration Strategy

1. **Dual Mode Support** (2 weeks)
   - New SessionManager reads both old and new cookies
   - Gradually migrate users to new structure
   - Monitor for issues

2. **Progressive Migration**
   ```typescript
   async function getServerAuthContext() {
     // Try new session structure first
     const session = await SessionManager.getActiveSession();
     if (session) return session;

     // Fall back to legacy cookies
     const legacy = await getLegacyAuth();
     if (legacy) {
       // Migrate to new structure
       await SessionManager.addAccount(legacy);
       return SessionManager.getActiveSession();
     }

     return null;
   }
   ```

3. **Cleanup** (after 30 days)
   - Remove legacy cookie support
   - Clean up migration code

## Code Examples

### Example: Updated getServerAuthContext
```typescript
// apps/web/src/lib/api/server-auth.ts
'use server';

import { SessionManager } from '@/lib/auth/session-manager';

export async function getServerAuthContext(): Promise<AuthContext | null> {
  const session = await SessionManager.getActiveSession();

  if (!session) {
    return null;
  }

  return {
    userId: session.userId,
    accessToken: session.accessToken,
    channelId: session.channelId, // Now includes active channel
  };
}
```

### Example: Account Switcher Component
```tsx
// apps/web/src/components/AccountSwitcher.tsx
'use client';

import { useMultiAccount } from '@/hooks/useMultiAccount';

export function AccountSwitcher() {
  const { accounts, activeAccount, switchAccount, addAccount } = useMultiAccount();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Avatar src={activeAccount?.avatarUrl} />
        <span>{activeAccount?.displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {accounts.map(account => (
          <DropdownMenuItem
            key={account.userId}
            onClick={() => switchAccount(account.userId)}
          >
            <Avatar src={account.avatarUrl} />
            <div>
              <p>{account.displayName}</p>
              <p className="text-sm">{account.email}</p>
            </div>
            {account.userId === activeAccount?.userId && <CheckIcon />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={addAccount}>
          <PlusIcon /> Add Account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Example: Channel Selector
```tsx
// apps/web/src/components/ChannelSelector.tsx
'use client';

import { useMultiAccount } from '@/hooks/useMultiAccount';

export function ChannelSelector() {
  const { channels, activeChannel, switchChannel } = useMultiAccount();

  if (channels.length <= 1) return null;

  return (
    <Select value={activeChannel?.id} onValueChange={switchChannel}>
      <SelectTrigger>
        <SelectValue placeholder="Select channel" />
      </SelectTrigger>
      <SelectContent>
        {channels.map(channel => (
          <SelectItem key={channel.id} value={channel.id}>
            <div className="flex items-center gap-2">
              <Avatar src={channel.avatarUrl} size="sm" />
              <span>{channel.name}</span>
              {channel.isMain && <Badge>Main</Badge>}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

## Testing Strategy

### Unit Tests
- SessionManager CRUD operations
- Cookie encryption/decryption
- Token refresh logic
- Migration utilities

### Integration Tests
- Multi-account login flow
- Account switching with API calls
- Channel switching with API calls
- Token expiry handling

### E2E Tests
- Complete user journey with multiple accounts
- Channel creation and switching
- Cross-account isolation
- Session persistence

## Monitoring & Metrics

Track the following metrics:
- Number of users with multiple accounts
- Average accounts per user
- Account switch frequency
- Channel switch frequency
- Token refresh success rate
- Cookie size distribution
- Migration progress

## Rollback Plan

If issues arise:
1. Revert to single-account mode via feature flag
2. Maintain backward compatibility layer
3. Gradual rollback per user segment
4. Keep legacy cookies until stable

## References
- [Next.js 15 Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [iron-session](https://github.com/vvo/iron-session)
- [OpenAuth Documentation](https://openauth.js.org/)
- [HTTP Cookie Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies)