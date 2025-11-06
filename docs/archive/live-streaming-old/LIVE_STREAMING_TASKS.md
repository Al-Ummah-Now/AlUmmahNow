# Live Streaming UI Implementation Tasks

This document contains a detailed breakdown of all tasks required to implement the live streaming UI for Al Ummah Now.

**Total Tasks**: 67
**Estimated Time**: 58-79 hours
**Status**: Ready for implementation

---

## Phase 1: Browse Experience (12 tasks)
**Estimated Time**: 14-19 hours

### Components

- [ ] **Task 1.1**: Create StreamStatusBadge component with all status variants
  - Location: `apps/web/src/components/StreamStatusBadge/index.tsx`
  - Status variants: scheduled, live, ended, cancelled
  - Include icons and color coding
  - Reference: Phase 1 implementation guide

- [ ] **Task 1.2**: Create ViewerCount component with animation support
  - Location: `apps/web/src/components/ViewerCount/index.tsx`
  - Display current viewer count
  - Add animated transitions for count changes
  - Support compact and full formats

- [ ] **Task 1.3**: Create LiveStreamCard component (English/LTR)
  - Location: `apps/web/src/components/LiveStreamCard/index.tsx`
  - Display thumbnail, title, channel info, status badge, viewer count
  - Add hover effects and click handlers
  - Mobile-responsive layout

- [ ] **Task 1.4**: Create LiveStreamCard RTL variant (Arabic)
  - Location: `apps/web/src/components/LiveStreamCard/rtl/index.tsx`
  - Mirror layout for RTL
  - Ensure proper text alignment
  - Test with Arabic content

### Data Layer

- [ ] **Task 1.5**: Create useLiveStreams custom hook with React Query
  - Location: `apps/web/src/hooks/useLiveStreams.ts`
  - Fetch live streams with pagination
  - Support filtering by status
  - Handle loading and error states
  - Implement caching strategy

### Pages

- [ ] **Task 1.6**: Create /en/live page with grid layout and filters
  - Location: `apps/web/src/app/en/live/page.tsx`
  - Grid layout for stream cards
  - Filter controls (status, category)
  - Responsive design

- [ ] **Task 1.7**: Create /ar/live page with RTL layout
  - Location: `apps/web/src/app/ar/live/page.tsx`
  - RTL layout and navigation
  - Arabic translations
  - Mirror of English functionality

### Features

- [ ] **Task 1.8**: Add tab navigation (Live Now, Scheduled, Past Streams)
  - Implement tab component
  - Filter streams by status
  - Update URL params for deep linking

- [ ] **Task 1.9**: Implement infinite scroll pagination
  - Use React Query's infinite queries
  - Load more on scroll
  - Show loading indicator

- [ ] **Task 1.10**: Add loading skeletons for cards
  - Create skeleton component
  - Match card dimensions
  - Animate shimmer effect

- [ ] **Task 1.11**: Add empty states for no streams
  - Design empty state component
  - Different messages per tab
  - Include CTA for creators

### Testing

- [ ] **Task 1.12**: Test Phase 1 components on mobile and desktop
  - Test on iOS/Android
  - Verify responsive breakpoints
  - Test touch interactions

---

## Phase 2: Creator Tools (15 tasks)
**Estimated Time**: 24-32 hours

### Wizard Components

- [ ] **Task 2.1**: Create GoLiveForm wizard structure (4 steps)
  - Location: `apps/web/src/components/GoLiveForm/index.tsx`
  - Multi-step wizard framework
  - Progress indicator
  - Step navigation

- [ ] **Task 2.2**: Implement Step 1 - Stream Details form with Zod validation
  - Title, description, category fields
  - Scheduled time picker
  - Language selector (EN/AR)
  - Privacy settings (public/private)
  - Chat enable/disable toggle
  - Zod schema validation

- [ ] **Task 2.3**: Implement Step 2 - Thumbnail upload with preview
  - File upload component
  - Image preview
  - Crop/resize functionality
  - Validation (size, format)
  - Upload progress indicator

- [ ] **Task 2.4**: Implement Step 3 - RTMP setup display
  - Display RTMP URL
  - Display stream key (with show/hide)
  - Copy to clipboard functionality
  - OBS/Streamlabs instructions
  - Security warnings

- [ ] **Task 2.5**: Implement Step 4 - Review and confirm
  - Display all entered data
  - Edit buttons for each section
  - Final submit button
  - Terms of service checkbox

### Stream Management

- [ ] **Task 2.6**: Create StreamSetup component with copy-to-clipboard
  - Location: `apps/web/src/components/StreamSetup/index.tsx`
  - Display RTMP credentials
  - Copy buttons with feedback
  - Setup instructions

- [ ] **Task 2.7**: Create StreamControls component (Go Live, End, Cancel)
  - Location: `apps/web/src/components/StreamControls/index.tsx`
  - Go Live button (scheduled → live)
  - End Stream button (live → ended)
  - Cancel button (scheduled → cancelled)
  - Confirmation dialogs

### Pages

- [ ] **Task 2.8**: Create /en/go-live page with authentication guard
  - Location: `apps/web/src/app/en/go-live/page.tsx`
  - Require authentication
  - Embed GoLiveForm wizard
  - Handle form submission

- [ ] **Task 2.9**: Create /ar/go-live page with RTL layout
  - Location: `apps/web/src/app/ar/go-live/page.tsx`
  - RTL wizard layout
  - Arabic translations
  - Same functionality as English

### Dashboard

- [ ] **Task 2.10**: Create StreamDashboard component for active streams
  - Location: `apps/web/src/components/StreamDashboard/index.tsx`
  - Show current stream status
  - Display stream analytics
  - Stream controls integration

- [ ] **Task 2.11**: Add real-time viewer count to dashboard
  - Live viewer count
  - Peak viewers
  - Historical chart (optional Phase 3)

### Integration

- [ ] **Task 2.12**: Implement stream status updates (scheduled → live → ended)
  - Use LiveStreamsAPI.update()
  - Handle state transitions
  - Update UI optimistically

- [ ] **Task 2.13**: Add error handling for stream creation failures
  - API error messages
  - Form field errors
  - Retry logic

- [ ] **Task 2.14**: Add success notifications and redirects
  - Toast notifications
  - Redirect to stream page
  - Share stream link

### Testing

- [ ] **Task 2.15**: Test form validation and API integration
  - Test all validation rules
  - Test API error scenarios
  - Verify state transitions

---

## Phase 3: Real-time Features (12 tasks)
**Estimated Time**: 20-28 hours

### WebSocket Integration

- [ ] **Task 3.1**: Create useLiveStreamWebSocket hook
  - Location: `apps/web/src/hooks/useLiveStreamWebSocket.ts`
  - Connect to WebSocket server
  - Subscribe to channels
  - Handle messages

- [ ] **Task 3.2**: Implement WebSocket connection with auto-reconnect
  - Use existing WebSocketProvider
  - Exponential backoff retry
  - Connection state management

- [ ] **Task 3.3**: Add channel subscription for live stream updates
  - Subscribe to `live-stream:{id}`
  - Subscribe to `channel:{id}`
  - Handle subscription responses

### Real-time Updates

- [ ] **Task 3.4**: Implement real-time viewer count updates with animations
  - Update ViewerCount component
  - Animate count changes
  - Throttle updates (max 1/sec)

- [ ] **Task 3.5**: Add real-time status change notifications
  - Listen for status changes
  - Update UI immediately
  - Show notifications

- [ ] **Task 3.6**: Implement presence tracking (who's watching)
  - Track active viewers
  - Display viewer avatars
  - Update on join/leave

### Optimizations

- [ ] **Task 3.7**: Add optimistic updates for better UX
  - Update UI before API response
  - Rollback on errors
  - Show loading states

- [ ] **Task 3.8**: Implement message throttling (max 100/min)
  - Rate limit outgoing messages
  - Queue excess messages
  - Show rate limit warnings

- [ ] **Task 3.9**: Add virtual scrolling for large stream lists
  - Use react-window or similar
  - Render only visible items
  - Maintain scroll position

- [ ] **Task 3.10**: Implement lazy loading for off-screen cards
  - Use Intersection Observer
  - Load images on demand
  - Reduce initial load time

### UI Feedback

- [ ] **Task 3.11**: Add connection status indicator
  - Show connected/disconnected state
  - Visual indicator (dot or icon)
  - Reconnecting message

### Testing

- [ ] **Task 3.12**: Test WebSocket reconnection scenarios
  - Test disconnect/reconnect
  - Test network failures
  - Test multiple tabs

---

## Phase 4: Navigation Integration (5 tasks)
**Estimated Time**: 3-5 hours

### Header Navigation

- [ ] **Task 4.1**: Add 'Live' navigation link to header
  - Location: Update header component
  - Add link to /live
  - Highlight when active
  - Show live indicator dot when streams are live

- [ ] **Task 4.2**: Add 'Go Live' button to authenticated user menu
  - Show only for authenticated users
  - Link to /go-live
  - Prominent styling

### Homepage Integration

- [ ] **Task 4.3**: Add live stream indicator to homepage
  - Show "Live Now" badge
  - Count of active streams
  - Link to /live

- [ ] **Task 4.4**: Create LiveStreamGrid component for homepage
  - Location: `apps/web/src/components/LiveStreamGrid/index.tsx`
  - Display 4-6 live streams
  - "View All" link
  - Horizontal scroll on mobile

### Channel Pages

- [ ] **Task 4.5**: Add 'Currently Live' section to channel pages
  - Show active streams for channel
  - Prominent placement
  - Link to full stream page

---

## Phase 5: Testing & Quality Assurance (20 tasks)
**Estimated Time**: 16-20 hours

### Type Safety

- [ ] **Task 5.1**: Run TypeScript type check on all new files
  - Command: `pnpm --filter @al-ummah/web type-check`
  - Fix any type errors
  - Ensure strict mode compliance

- [ ] **Task 5.2**: Fix any TypeScript errors or warnings
  - Review all error messages
  - Add proper type annotations
  - Remove any `any` types

### Code Quality

- [ ] **Task 5.3**: Run ESLint on all new components
  - Command: `pnpm --filter @al-ummah/web lint`
  - Follow project conventions
  - Check accessibility rules

- [ ] **Task 5.4**: Fix any linting issues
  - Fix auto-fixable issues
  - Manually fix remaining issues
  - Document exceptions if needed

### Unit Tests

- [ ] **Task 5.5**: Write unit tests for StreamStatusBadge
  - Test all status variants
  - Test props and rendering
  - Test accessibility

- [ ] **Task 5.6**: Write unit tests for ViewerCount
  - Test count display
  - Test animations
  - Test edge cases (0, large numbers)

- [ ] **Task 5.7**: Write unit tests for LiveStreamCard
  - Test rendering with mock data
  - Test click handlers
  - Test responsive behavior

- [ ] **Task 5.8**: Write unit tests for useLiveStreams hook
  - Test data fetching
  - Test pagination
  - Test error handling

- [ ] **Task 5.9**: Write unit tests for GoLiveForm validation
  - Test Zod schemas
  - Test field validation
  - Test form submission

- [ ] **Task 5.10**: Write unit tests for useLiveStreamWebSocket hook
  - Mock WebSocket connection
  - Test message handling
  - Test reconnection logic

### Integration Tests

- [ ] **Task 5.11**: Write integration tests for live stream creation flow
  - Test end-to-end wizard
  - Test API integration
  - Test success/error paths

- [ ] **Task 5.12**: Test authentication flow for Go Live page
  - Test redirect for unauthenticated users
  - Test access for authenticated users
  - Test session expiry

- [ ] **Task 5.13**: Test RTMP credentials display and copy
  - Test credential generation
  - Test copy to clipboard
  - Test show/hide functionality

- [ ] **Task 5.14**: Test real-time updates with multiple clients
  - Open multiple browser tabs
  - Verify updates propagate
  - Test race conditions

### Accessibility

- [ ] **Task 5.15**: Perform accessibility audit (WCAG 2.1 AA)
  - Run axe DevTools
  - Check keyboard navigation
  - Test screen reader support
  - Verify color contrast
  - Test focus management

### Mobile Testing

- [ ] **Task 5.16**: Test mobile responsiveness on iOS and Android
  - Test on physical devices
  - Test all breakpoints
  - Test touch interactions
  - Test virtual keyboard behavior

### Internationalization

- [ ] **Task 5.17**: Test RTL layout in Arabic mode
  - Verify all components mirror correctly
  - Test text alignment
  - Test icon placement

- [ ] **Task 5.18**: Test dark mode for all components
  - Verify all colors work in dark mode
  - Test contrast ratios
  - Test transitions

### Performance

- [ ] **Task 5.19**: Performance test with 100+ streams
  - Load test with large dataset
  - Measure render time
  - Check memory usage
  - Verify virtual scrolling

### Final Validation

- [ ] **Task 5.20**: Run full test suite and ensure 100% pass rate
  - Command: `pnpm --filter @al-ummah/web test`
  - All tests must pass
  - Review coverage report

---

## Phase 6: Documentation & Deployment (6 tasks)
**Estimated Time**: 4-6 hours

### Build Verification

- [ ] **Task 6.1**: Build web app for production
  - Command: `pnpm --filter @al-ummah/web build`
  - Verify build completes
  - Check bundle size

- [ ] **Task 6.2**: Verify no build errors or warnings
  - Review build output
  - Fix any issues
  - Optimize bundle if needed

### Documentation

- [ ] **Task 6.3**: Create deployment checklist document
  - Location: `docs/LIVE_STREAMING_DEPLOYMENT.md`
  - Pre-deployment steps
  - Deployment steps
  - Post-deployment verification

- [ ] **Task 6.4**: Document environment variables needed
  - List all required env vars
  - Document Bunny.net setup
  - Document WebSocket configuration

- [ ] **Task 6.5**: Create user guide for streamers
  - Location: `docs/STREAMER_GUIDE.md`
  - How to go live
  - RTMP setup instructions
  - Troubleshooting guide

- [ ] **Task 6.6**: Update API documentation with live stream endpoints
  - Update Swagger UI descriptions
  - Add example requests/responses
  - Document authentication requirements

---

## Quick Reference

### File Structure
```
apps/web/src/
├── components/
│   ├── StreamStatusBadge/
│   │   └── index.tsx
│   ├── ViewerCount/
│   │   └── index.tsx
│   ├── LiveStreamCard/
│   │   ├── index.tsx
│   │   └── rtl/index.tsx
│   ├── GoLiveForm/
│   │   └── index.tsx
│   ├── StreamSetup/
│   │   └── index.tsx
│   ├── StreamControls/
│   │   └── index.tsx
│   ├── StreamDashboard/
│   │   └── index.tsx
│   └── LiveStreamGrid/
│       └── index.tsx
├── hooks/
│   ├── useLiveStreams.ts
│   └── useLiveStreamWebSocket.ts
├── app/
│   ├── en/
│   │   ├── live/
│   │   │   └── page.tsx
│   │   └── go-live/
│   │       └── page.tsx
│   └── ar/
│       ├── live/
│       │   └── page.tsx
│       └── go-live/
│           └── page.tsx
└── lib/
    └── api/
        └── livestreams.ts (✅ already created)
```

### Related Documentation
- Architecture: `/docs/architecture/ADR-001-live-streaming-ui.md`
- Components: `/docs/architecture/live-streaming-components.md`
- Phase 2 Guide: `/docs/PHASE_2_GO_LIVE_IMPLEMENTATION.md`
- Phase 3 Guide: `/docs/live-streaming-phase-3-implementation.md`

### Key APIs
- `LiveStreamsAPI.list()` - Fetch streams
- `LiveStreamsAPI.create()` - Create stream
- `LiveStreamsAPI.update()` - Update stream
- `LiveStreamsAPI.goLive()` - Start stream
- `LiveStreamsAPI.endStream()` - End stream
- `LiveStreamsAPI.getLiveNow()` - Get live streams
- `LiveStreamsAPI.getScheduled()` - Get scheduled streams

### Environment Variables
- `bunny-stream-key` - Bunny.net Stream API key
- `bunny_stream_library_id` - Bunny Stream library ID
- `image_storage_key` - Bunny.net Storage for images
- `ZONE` - Bunny.net storage zone name

---

## Progress Tracking

**Completed**: 0 / 67 tasks
**In Progress**: 0 tasks
**Pending**: 67 tasks

Update this document as you complete tasks to track your progress!
