# Task 2.8: /en/go-live Page (English)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 6 hours
**Dependencies**: Task 2.6 (StreamSetupComponent)
**Status**: 📝 Not Started

---

## Goal

Create a protected English language page for creators to start live streams, with authentication guards, quota validation, channel requirements, and progressive enhancement.

## Architecture Pattern

**Pattern**: Protected Server Component with Progressive Enhancement
**Strategy**: Server-side auth check, client-side interactivity

## Component Structure

```typescript
// File: /apps/web/src/app/en/go-live/page.tsx
interface GoLivePageProps {
  searchParams?: {
    template?: string;
    schedule?: string;
    returnTo?: string;
    channelId?: string;
  };
}

// Server Component
export default async function GoLivePage({ searchParams }: GoLivePageProps) {
  const session = await getAuthSession();

  // Authentication guard
  if (!session?.user) {
    const returnUrl = `/en/go-live?${new URLSearchParams(searchParams as any)}`;
    redirect(`/en/auth/signin?redirect=${encodeURIComponent(returnUrl)}`);
  }

  // Parallel data fetching
  const [userQuota, userChannels, templates] = await Promise.all([
    getUserStreamingQuota(session.user.id),
    getUserChannels(session.user.id),
    searchParams?.template ? getTemplate(searchParams.template) : null
  ]);

  // Quota validation
  if (!userQuota.canStream) {
    return <QuotaExceededView quota={userQuota} user={session.user} />;
  }

  // Channel requirement
  if (userChannels.length === 0) {
    return <CreateChannelFirstView user={session.user} />;
  }

  // Pre-populate form data from query params
  const initialData = {
    template: templates,
    scheduledTime: searchParams?.schedule,
    channelId: searchParams?.channelId || userChannels[0].id
  };

  return (
    <GoLivePageClient
      user={session.user}
      channels={userChannels}
      quota={userQuota}
      initialData={initialData}
    />
  );
}

// Client Component
'use client';
const GoLivePageClient: React.FC<GoLivePageClientProps> = ({
  user,
  channels,
  quota,
  initialData
}) => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <PageHeader
        title="Go Live"
        description="Set up your live stream in 4 easy steps"
        user={user}
      />

      <QuotaIndicator quota={quota} />

      <StreamSetupWizard
        userId={user.id}
        channels={channels}
        initialData={initialData}
        onSuccess={(streamId) => router.push(`/en/dashboard/streams/${streamId}`)}
        onCancel={() => router.push('/en/dashboard')}
      />
    </div>
  );
};
```

## Data Flow

```
Page Load → Check Auth → Fetch User Data (parallel)
     ↓           ↓              ↓
Not Authed → Redirect to Login
     ↓
Authed → Check Quota → Has Quota?
     ↓                      ↓
No Quota → Show Upgrade
     ↓                      ↓
Has Quota → Check Channels → Has Channel?
     ↓                              ↓
No Channel → Create Channel First
     ↓                              ↓
Has Channel → Pre-fill Form → Render Wizard
```

## Dependencies

- **OpenAuth** - Authentication system
- **Next.js Server Components** - SSR
- **Suspense** - Loading states

## Integration Points

- OpenAuth session API
- User service (quota, channels)
- Template service (presets)
- Analytics (page views, conversions)

## Performance Considerations

```typescript
// Edge runtime for faster response
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// Prefetch critical resources
export const metadata = {
  title: 'Go Live | Al Ummah Now',
  description: 'Start your live stream',
  openGraph: {
    title: 'Go Live | Al Ummah Now',
    description: 'Start streaming to your audience'
  }
};

// Parallel data fetching with streaming
const GoLivePageOptimized = async ({ searchParams }) => {
  // Start auth check immediately
  const sessionPromise = getAuthSession();

  // Fetch other data in parallel
  const [session, categories, recentStreams] = await Promise.all([
    sessionPromise,
    getStreamCategories(),
    sessionPromise.then(s => s?.user ? getUserRecentStreams(s.user.id, 5) : [])
  ]);

  // ... rest of logic
};

// Prefetch resources for wizard
<link rel="prefetch" href="/api/live-streams" />
<link rel="preconnect" href="https://bunny.net" />
<link rel="dns-prefetch" href="https://ingest.alummahnow.net" />
```

## Security Considerations

```typescript
// Multi-factor authentication for high-value accounts
const requireStreamingMFA = async (user: User): Promise<boolean> => {
  if (user.isVerified && !user.mfaEnabled) {
    redirect('/en/security/enable-mfa?reason=streaming&return=/en/go-live');
  }

  const mfaSession = await getMFASession();
  if (!mfaSession || mfaSession.expiresAt < Date.now()) {
    redirect('/en/security/verify-mfa?action=streaming&return=/en/go-live');
  }

  return true;
};

// Rate limiting per user
const checkStreamingRateLimit = async (userId: string): Promise<RateLimitResult> => {
  const key = `streaming:${userId}`;
  const limit = 5; // 5 stream creations per hour
  const window = 3600; // 1 hour

  const current = await kv.incr(key);
  if (current === 1) {
    await kv.expire(key, window);
  }

  if (current > limit) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: Date.now() + (window * 1000)
  };
};

// Content Security Policy
export const headers = {
  'Content-Security-Policy': "frame-ancestors 'none'; default-src 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff'
};
```

## Error Handling

```typescript
// Error boundary for page-level errors
export function GoLiveErrorBoundary({
  error,
  reset
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, {
      page: 'go-live',
      lang: 'en',
      user: getCurrentUser(),
      context: getErrorContext()
    });
  }, [error]);

  if (error.message.includes('quota')) {
    return (
      <ErrorView
        title="Streaming Quota Exceeded"
        message="You've reached your monthly streaming limit."
        actions={[
          { label: 'Upgrade Plan', href: '/en/billing/upgrade', primary: true },
          { label: 'View Usage', href: '/en/dashboard/usage' }
        ]}
      />
    );
  }

  if (error.message.includes('permission')) {
    return (
      <ErrorView
        title="Permission Denied"
        message="You don't have permission to stream on this channel."
        actions={[
          { label: 'Request Access', onClick: () => requestStreamingAccess() },
          { label: 'Back to Dashboard', href: '/en/dashboard' }
        ]}
      />
    );
  }

  if (error.message.includes('rate_limit')) {
    return (
      <ErrorView
        title="Too Many Requests"
        message="You're creating streams too quickly. Please wait a moment."
        actions={[
          { label: 'Try Again', onClick: reset, primary: true }
        ]}
      />
    );
  }

  return (
    <ErrorView
      title="Something Went Wrong"
      message="We encountered an unexpected error. Please try again."
      actions={[
        { label: 'Retry', onClick: reset, primary: true },
        { label: 'Contact Support', onClick: () => openSupportChat() }
      ]}
    />
  );
}
```

## Type Safety

```typescript
// Page-level context types
interface GoLivePageContext {
  user: AuthUser;
  channels: Channel[];
  quota: StreamingQuota;
  categories: Category[];
  templates?: StreamTemplate[];
  features: FeatureFlags;
}

interface StreamingQuota {
  canStream: boolean;
  maxConcurrentStreams: number;
  currentStreams: number;
  maxDuration: number; // minutes
  maxBitrate: number; // kbps
  storageLimit: number; // GB
  storageUsed: number; // GB
  resetAt: string; // ISO date
}

interface Channel {
  id: string;
  name: string;
  description?: string;
  subscriberCount: number;
  canStream: boolean;
  ownerId: string;
}

interface StreamTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  settings: Partial<StreamDetailsData>;
  thumbnail?: string;
  isPublic: boolean;
  createdBy: string;
}
```

## Testing Criteria

- [ ] Unauthenticated users redirected to login
- [ ] Quota exceeded shows upgrade page
- [ ] No channel shows channel creation
- [ ] Template pre-fills form data
- [ ] Scheduled time from query param works
- [ ] Channel ID from query param works
- [ ] Success redirects to dashboard
- [ ] Cancel returns to previous page
- [ ] Error boundary catches errors
- [ ] MFA enforced for verified users

## Acceptance Criteria

- [ ] Protected route (auth required)
- [ ] Server-side quota validation
- [ ] Channel requirement check
- [ ] Template support (query param)
- [ ] Schedule support (query param)
- [ ] Progressive enhancement (works without JS)
- [ ] Quota indicator in header
- [ ] 4-step wizard embedded
- [ ] Success redirect to stream dashboard
- [ ] Error handling with recovery
- [ ] Analytics tracking (page view, completion)

## Related Tasks

- **Depends On**: Task 2.6 (StreamSetupComponent)
- **Blocks**: Task 2.9 (Arabic version)
- **Related**: Task 2.10 (Stream Dashboard)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-8-engo-live-page)
- [Next.js Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
