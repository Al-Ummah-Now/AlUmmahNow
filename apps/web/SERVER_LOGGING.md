# Server-Side Logging Configuration

All server-side code in the web app now uses the unified logger (`@al-ummah/logger`) which sends logs to the log service via HTTP.

## Files Updated

### Server Actions (`'use server'`)
1. **src/lib/api/server-auth.ts** - Authentication context logging
2. **src/lib/api/channels.ts** - Channel avatar/cover upload logging
3. **src/lib/actions/multi-account.ts** - Multi-account management logging

### API Routes
4. **src/app/api/callback/route.ts** - OAuth callback logging
5. **src/app/api/callback/multi-account/route.ts** - Multi-account callback logging

## Logger Usage

```typescript
import { logger } from '@/lib/logger';

// Info logs
logger.info('Operation succeeded', { userId: '123', channelId: '456' });

// Error logs
logger.error('Operation failed', error);

// Debug logs (only in development)
logger.debug('Debug info', { data: {...} });

// Warning logs
logger.warn('Warning message', { context: {...} });
```

## Log Service Integration

The logger automatically:
- ✅ Sends logs to log service via HTTP (`forceHttpLogging: true`)
- ✅ Works server-side only (server actions + API routes)
- ✅ Includes structured data (objects are serialized)
- ✅ Respects log level from `LOG_LEVEL` env var

## Channel Upload Logging

When uploading channel avatar/cover, the following logs are sent to the log service:

1. **Auth Context** - Shows token availability and user/channel IDs
2. **Request Headers** - Shows Authorization header presence
3. **Response** - Shows API response status
4. **Error** - Shows detailed error if upload fails with 401

## Querying Logs

To view channel upload logs in your log service:

```
Service: web
Message contains: "updateChannelAvatar" OR "updateChannelCover"
Log Level: info OR error
```

Look for these specific log entries:
- `[updateChannelAvatar] Auth context` - Check `hasToken`, `tokenLength`
- `[updateChannelAvatar] Request headers` - Check `hasAuth`
- `[updateChannelAvatar] Response` - Check `status`
- `[updateChannelAvatar] Failed` - Check `errorBody` for API error details

## Next Steps

1. Upload a channel avatar/cover to generate logs
2. Query log service for entries matching the filters above
3. Check if `hasToken: true` and `tokenLength > 0`
4. If token is present but API returns 401, the token is invalid or expired
5. If token is missing (`hasToken: false`), check session/cookie storage
