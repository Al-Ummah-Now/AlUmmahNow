# Live Streaming Phase 3: Real-time Architecture Specifications

## Executive Summary

This document provides production-ready architectural specifications for implementing real-time WebSocket features in Al Ummah Now's live streaming platform. Each specification includes detailed patterns, dependencies, performance considerations, and error handling strategies.

**Architecture Principles:**
- **Reliability First**: Auto-reconnection with exponential backoff
- **Performance Optimized**: Throttling, debouncing, virtual scrolling
- **Resource Efficient**: Cleanup subscriptions, prevent memory leaks
- **User Experience**: Optimistic updates, smooth animations

---

## 1. useLiveStreamWebSocket Hook

### Architecture Pattern
**Pattern**: Custom React Hook with WebSocket Manager integration
**Type**: Stateful connection management with subscription-based updates

### Component Structure
```typescript
interface UseLiveStreamWebSocketOptions {
  streamId?: string;
  enableMetrics?: boolean;
  enablePresence?: boolean;
  throttleMs?: number; // Default: 100ms
  reconnectStrategy?: 'exponential' | 'linear' | 'fixed';
}

interface UseLiveStreamWebSocketReturn {
  // Connection State
  isConnected: boolean;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';

  // Stream Data
  status: StreamStatus;
  viewerCount: number;
  peakViewers: number;
  duration: number;

  // Presence
  viewers: ViewerInfo[];

  // Methods
  reconnect: () => Promise<void>;
  sendMessage: (type: string, data: any) => void;

  // Metrics
  metrics: ConnectionMetrics;
}
```

### Data Flow
```
User Component → useLiveStreamWebSocket → WebSocketProvider → WebSocketManager
                            ↓                      ↓                ↓
                      State Updates ← Message Queue ← Durable Object
```

### Dependencies
- `@/lib/websocket/WebSocketProvider`
- `@/lib/websocket/WebSocketManager`
- `@/lib/utils/performance` (throttle, debounce)
- `@/interfaces/websocket` (types)

### Performance Considerations
- **Message Batching**: Queue messages and process in batches every 50ms
- **Throttling**: Limit state updates to max 10/second (100ms throttle)
- **Memory Management**: Cleanup subscriptions on unmount
- **Deduplication**: Track message IDs to prevent duplicates

### Connection Management
```typescript
const reconnectStrategy = {
  exponential: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
  linear: (attempt) => Math.min(1000 * attempt, 30000),
  fixed: () => 5000
};
```

### Error Handling
- **Connection Failures**: Auto-retry with backoff
- **Auth Errors**: Refresh token and reconnect
- **Rate Limiting**: Queue messages and retry after delay
- **Network Loss**: Buffer messages for up to 30 seconds

### Type Safety
```typescript
// Strongly typed WebSocket messages
interface LiveStreamMessage extends WebSocketMessage {
  data: LiveStreamUpdate | ViewerUpdate | PresenceUpdate | MetricsUpdate;
}

type LiveStreamUpdate = {
  type: 'stream_update';
  streamId: string;
  status: StreamStatus;
  metadata?: Record<string, any>;
};
```

---

## 2. WebSocket Connection with Auto-reconnect

### Architecture Pattern
**Pattern**: State Machine-based connection management
**States**: `disconnected` → `connecting` → `connected` → `reconnecting`

### Component Structure
```typescript
class WebSocketConnection {
  private state: ConnectionState;
  private ws: WebSocket | null;
  private reconnectTimer: NodeJS.Timeout | null;
  private heartbeatTimer: NodeJS.Timeout | null;
  private messageBuffer: Message[];

  // State machine transitions
  private transitions = {
    disconnected: ['connecting'],
    connecting: ['connected', 'reconnecting', 'disconnected'],
    connected: ['reconnecting', 'disconnected'],
    reconnecting: ['connected', 'disconnected']
  };
}
```

### Data Flow
```
Connection Request → State: Connecting → WebSocket.open()
        ↓                    ↓                  ↓
   Auth Token → Send Auth → State: Connected → Start Heartbeat
        ↓                                           ↓
   On Error → State: Reconnecting → Exponential Backoff → Retry
```

### Dependencies
- Native WebSocket API
- JWT token from OpenAuth
- Performance API for timing metrics

### Performance Considerations
- **Connection Pooling**: Reuse single connection for all subscriptions
- **Message Compression**: Enable WebSocket compression
- **Binary Protocol**: Use MessagePack for smaller payloads
- **Keep-Alive**: 30-second heartbeat interval

### Connection Management
```typescript
interface ConnectionManager {
  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;

  // Health monitoring
  getConnectionHealth(): ConnectionHealth;
  isHealthy(): boolean;

  // Metrics
  getLatency(): number;
  getUptime(): number;
  getReconnectCount(): number;
}
```

### Error Handling
```typescript
const errorHandlers = {
  1006: () => reconnectWithBackoff(), // Abnormal closure
  1008: () => refreshAuthAndReconnect(), // Policy violation (auth)
  1011: () => handleServerError(), // Server error
  1015: () => handleTLSError() // TLS handshake error
};
```

### Type Safety
```typescript
enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting'
}

interface ConnectionHealth {
  state: ConnectionState;
  latency: number;
  packetLoss: number;
  reconnectCount: number;
  uptime: number;
}
```

---

## 3. Channel Subscription for Live Stream Updates

### Architecture Pattern
**Pattern**: Pub/Sub with channel-based routing
**Channels**: `livestream:{id}`, `livestream:{id}:chat`, `livestream:{id}:metrics`

### Component Structure
```typescript
class ChannelSubscriptionManager {
  private subscriptions: Map<string, Subscription>;
  private channelCallbacks: Map<string, Set<Callback>>;
  private pendingSubscriptions: Set<string>;

  subscribe(channel: string, callback: Callback): Unsubscribe;
  unsubscribe(channel: string): void;
  broadcast(channel: string, message: any): void;
}
```

### Data Flow
```
Subscribe Request → Check Cache → Send Subscribe Message
        ↓              ↓                    ↓
   Add Callback → Already Subscribed? → Server Confirms
        ↓                                   ↓
   Store Subscription ← Route Messages ← Receive Updates
```

### Dependencies
- WebSocketManager for message transport
- Channel naming conventions
- Message routing logic

### Performance Considerations
- **Subscription Batching**: Group multiple subscriptions in single message
- **Channel Caching**: Cache subscription state to avoid duplicates
- **Selective Updates**: Only subscribe to needed fields
- **Unsubscribe on Idle**: Auto-unsubscribe after 5 minutes of inactivity

### Connection Management
```typescript
interface SubscriptionOptions {
  autoResubscribe: boolean; // Re-subscribe on reconnect
  idleTimeout: number; // Auto-unsubscribe timeout
  filter?: (message: any) => boolean; // Client-side filtering
  transform?: (message: any) => any; // Message transformation
}
```

### Error Handling
- **Subscription Failures**: Retry with exponential backoff
- **Invalid Channels**: Validate channel format before subscribing
- **Permission Errors**: Handle 403 responses gracefully
- **Duplicate Subscriptions**: Dedupe on client side

### Type Safety
```typescript
type ChannelName =
  | `livestream:${string}`
  | `livestream:${string}:chat`
  | `livestream:${string}:metrics`
  | `livestream:${string}:presence`;

interface Subscription {
  channel: ChannelName;
  subscribedAt: number;
  lastActivity: number;
  messageCount: number;
  callbacks: Set<(data: any) => void>;
}
```

---

## 4. Real-time Viewer Count Updates with Animations

### Architecture Pattern
**Pattern**: Animated counter with differential updates
**Animation**: Spring physics for smooth transitions

### Component Structure
```typescript
interface ViewerCountProps {
  streamId: string;
  initialCount?: number;
  showAnimation?: boolean;
  showTrend?: boolean;
  animationDuration?: number; // Default: 300ms
}

const ViewerCount: React.FC<ViewerCountProps> = ({
  streamId,
  initialCount = 0,
  showAnimation = true,
  showTrend = true,
  animationDuration = 300
}) => {
  const { viewerCount, trend } = useViewerCount(streamId);
  const animatedValue = useSpring(viewerCount);

  return (
    <AnimatedCounter
      value={animatedValue}
      trend={trend}
      duration={animationDuration}
    />
  );
};
```

### Data Flow
```
WebSocket Message → Parse Viewer Count → Calculate Delta
        ↓                   ↓                  ↓
   Update State → Trigger Animation → Update Display
        ↓                                    ↓
   Track Trend ← Store Peak Value ← Render Changes
```

### Dependencies
- `@react-spring/web` for animations
- `useLiveStreamWebSocket` hook
- Number formatting utilities

### Performance Considerations
- **RAF Scheduling**: Use requestAnimationFrame for smooth animations
- **Throttled Updates**: Limit to 10 updates/second
- **Number Formatting**: Memoize formatted strings
- **GPU Acceleration**: Use CSS transforms for animations

### Connection Management
```typescript
interface ViewerCountManager {
  // Real-time updates
  subscribeToViewerCount(streamId: string): void;
  unsubscribeFromViewerCount(streamId: string): void;

  // Fallback polling
  enablePolling(interval: number): void;
  disablePolling(): void;

  // Manual refresh
  refreshViewerCount(): Promise<number>;
}
```

### Error Handling
- **Missing Updates**: Fall back to polling every 30 seconds
- **Invalid Numbers**: Validate and sanitize viewer counts
- **Animation Failures**: Graceful degradation to instant updates

### Type Safety
```typescript
interface ViewerCountState {
  current: number;
  peak: number;
  average: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  lastUpdate: number;
  isLive: boolean;
}

type AnimationConfig = {
  tension: number; // Spring tension (default: 300)
  friction: number; // Spring friction (default: 30)
  precision: number; // Animation precision (default: 0.01)
};
```

---

## 5. Real-time Status Change Notifications

### Architecture Pattern
**Pattern**: Event-driven notification system with priority queuing
**Priority Levels**: `critical` > `high` > `normal` > `low`

### Component Structure
```typescript
class StatusNotificationManager {
  private notificationQueue: PriorityQueue<Notification>;
  private activeNotifications: Map<string, Notification>;
  private dismissTimers: Map<string, NodeJS.Timeout>;

  notify(notification: Notification): void;
  dismiss(notificationId: string): void;
  dismissAll(): void;
}
```

### Data Flow
```
Status Change Event → Create Notification → Priority Queue
        ↓                    ↓                    ↓
   Determine Type → Set Priority → Display with Animation
        ↓                              ↓
   Auto-dismiss Timer ← User Action ← Track Interaction
```

### Dependencies
- WebSocket for real-time events
- Toast/notification UI library
- Animation library for transitions

### Performance Considerations
- **Queue Management**: Limit to 5 concurrent notifications
- **Debouncing**: Collapse rapid status changes into single notification
- **Memory Cleanup**: Clear dismissed notifications from memory
- **Animation Performance**: Use CSS animations over JS

### Connection Management
```typescript
interface NotificationConnection {
  // Subscribe to status changes
  subscribeToStatus(streamId: string): void;

  // Notification preferences
  setNotificationFilter(filter: NotificationFilter): void;

  // Batch notifications
  enableBatching(interval: number): void;
}
```

### Error Handling
- **Notification Failures**: Log but don't crash
- **Queue Overflow**: Drop oldest low-priority notifications
- **Animation Errors**: Skip animation and show instantly

### Type Safety
```typescript
interface StatusNotification {
  id: string;
  type: 'stream_started' | 'stream_ended' | 'stream_error' | 'quality_change';
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  message: string;
  timestamp: number;
  duration?: number; // Auto-dismiss time
  actions?: NotificationAction[];
}

interface NotificationAction {
  label: string;
  action: () => void;
  style?: 'primary' | 'secondary' | 'danger';
}
```

---

## 6. Presence Tracking (Who's Watching)

### Architecture Pattern
**Pattern**: Distributed presence with heartbeat-based tracking
**Storage**: Cloudflare KV for presence state

### Component Structure
```typescript
class PresenceTracker {
  private presenceMap: Map<string, PresenceInfo>;
  private heartbeatInterval: NodeJS.Timeout;
  private lastHeartbeat: number;

  join(streamId: string, userInfo: UserInfo): void;
  leave(streamId: string): void;
  updatePresence(status: PresenceStatus): void;
  getViewers(): ViewerInfo[];
}
```

### Data Flow
```
User Joins Stream → Send Presence Update → KV Store
        ↓                   ↓                  ↓
   Start Heartbeat → Track in Memory → Broadcast to Others
        ↓                                      ↓
   30s Intervals → Update Last Seen → Remove if Stale
```

### Dependencies
- Cloudflare KV for persistence
- WebSocket for real-time updates
- User profile data

### Performance Considerations
- **Batch Updates**: Group presence updates every 5 seconds
- **Heartbeat Interval**: 30-second heartbeat to reduce traffic
- **Presence Limit**: Show max 100 viewers in UI
- **Lazy Loading**: Load additional viewers on demand

### Connection Management
```typescript
interface PresenceManager {
  // Lifecycle
  startTracking(streamId: string): void;
  stopTracking(streamId: string): void;

  // Heartbeat
  sendHeartbeat(): void;
  handleStalePresence(): void;

  // Queries
  getActiveViewers(): ViewerInfo[];
  getViewerCount(): number;
  isUserWatching(userId: string): boolean;
}
```

### Error Handling
- **Heartbeat Failures**: Mark user as potentially offline
- **KV Errors**: Continue with in-memory tracking
- **Network Issues**: Buffer presence updates

### Type Safety
```typescript
interface PresenceInfo {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  status: 'active' | 'idle' | 'away';
  joinedAt: number;
  lastSeen: number;
  deviceInfo?: {
    type: 'desktop' | 'mobile' | 'tablet';
    browser?: string;
  };
}

interface PresenceUpdate {
  type: 'join' | 'leave' | 'update';
  streamId: string;
  userId: string;
  presence?: PresenceInfo;
  timestamp: number;
}
```

---

## 7. Optimistic Updates for Better UX

### Architecture Pattern
**Pattern**: Optimistic UI with rollback capability
**Strategy**: Apply changes immediately, confirm asynchronously

### Component Structure
```typescript
class OptimisticStateManager<T> {
  private optimisticState: T;
  private confirmedState: T;
  private pendingUpdates: Map<string, PendingUpdate<T>>;
  private rollbackHandlers: Map<string, () => void>;

  applyOptimistic(update: Partial<T>): string;
  confirmUpdate(updateId: string): void;
  rollbackUpdate(updateId: string): void;
}
```

### Data Flow
```
User Action → Apply Optimistic Update → Update UI
      ↓                ↓                    ↓
   Send to Server → Store Rollback → Show Loading State
      ↓                                     ↓
   Server Response → Confirm/Rollback → Final State
```

### Dependencies
- State management (React state/context)
- Unique ID generator for updates
- Rollback handlers

### Performance Considerations
- **Immediate Feedback**: Zero-latency UI updates
- **Conflict Resolution**: Handle concurrent optimistic updates
- **Memory Management**: Clear confirmed updates from memory
- **Timeout Handling**: Auto-rollback after 5 seconds

### Connection Management
```typescript
interface OptimisticConnection {
  // Apply update optimistically
  applyUpdate<T>(update: T): Promise<T>;

  // Rollback on error
  handleError(error: Error, updateId: string): void;

  // Sync state
  syncWithServer(): Promise<void>;
}
```

### Error Handling
```typescript
const rollbackStrategies = {
  immediate: () => rollbackImmediately(),
  delayed: () => setTimeout(rollback, 1000),
  userConfirm: () => showRollbackDialog(),
  silent: () => rollbackSilently()
};
```

### Type Safety
```typescript
interface OptimisticUpdate<T> {
  id: string;
  type: 'create' | 'update' | 'delete';
  optimisticValue: T;
  previousValue: T;
  appliedAt: number;
  confirmedAt?: number;
  rolledBackAt?: number;
  error?: Error;
}

type UpdateState = 'pending' | 'confirmed' | 'failed' | 'rolled_back';
```

---

## 8. Message Throttling (Max 100/min)

### Architecture Pattern
**Pattern**: Token bucket algorithm with sliding window
**Limits**: 100 messages/minute per connection

### Component Structure
```typescript
class MessageThrottler {
  private tokenBucket: number;
  private lastRefill: number;
  private messageHistory: number[];
  private queuedMessages: QueuedMessage[];

  canSend(): boolean;
  send(message: Message): boolean;
  getQueueSize(): number;
  getRemainingTokens(): number;
}
```

### Data Flow
```
Message Request → Check Token Bucket → Has Tokens?
        ↓                ↓                  ↓
   Add to Queue → Wait for Tokens → Send Message
        ↓                              ↓
   Process Queue ← Refill Tokens ← Track Usage
```

### Dependencies
- Queue data structure
- High-resolution timer (performance.now())
- Message priority system

### Performance Considerations
- **Efficient Queue**: Use circular buffer for O(1) operations
- **Token Calculation**: Lazy evaluation of token refills
- **Priority Messages**: Bypass throttling for critical messages
- **Burst Handling**: Allow short bursts within limits

### Connection Management
```typescript
interface ThrottleConfig {
  maxMessages: number; // Max messages per window
  windowMs: number; // Time window in milliseconds
  burstSize: number; // Allow burst up to this size
  priority: {
    high: number; // Priority multiplier for important messages
    normal: number;
    low: number;
  };
}
```

### Error Handling
- **Queue Overflow**: Drop oldest low-priority messages
- **Rate Limit Exceeded**: Return clear error to user
- **Server Rejection**: Adjust local throttle limits

### Type Safety
```typescript
interface ThrottleState {
  tokens: number;
  maxTokens: number;
  refillRate: number; // Tokens per second
  queuedCount: number;
  droppedCount: number;
  lastActivity: number;
}

interface QueuedMessage {
  id: string;
  message: any;
  priority: 'high' | 'normal' | 'low';
  queuedAt: number;
  attempts: number;
}
```

---

## 9. Virtual Scrolling for Large Stream Lists

### Architecture Pattern
**Pattern**: Windowed rendering with dynamic item heights
**Strategy**: Render only visible items + overscan

### Component Structure
```typescript
interface VirtualScrollerProps<T> {
  items: T[];
  itemHeight: number | ((item: T) => number);
  overscan?: number; // Items to render outside viewport
  scrollThreshold?: number; // Pixels before edge to trigger load
  onEndReached?: () => void;
}

const VirtualScroller: React.FC<VirtualScrollerProps> = ({
  items,
  itemHeight,
  overscan = 3,
  scrollThreshold = 100
}) => {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 10 });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Calculate visible items based on scroll position
  // Render only visible items with proper offsetting
};
```

### Data Flow
```
Scroll Event → Calculate Viewport → Determine Visible Range
      ↓              ↓                        ↓
   Throttle → Get Scroll Position → Calculate Item Positions
      ↓                                      ↓
   Update State ← Render Items ← Apply Transforms
```

### Dependencies
- ResizeObserver for container size changes
- IntersectionObserver for visibility detection
- RAF for smooth scrolling

### Performance Considerations
- **Scroll Throttling**: Limit calculations to 60fps
- **Height Caching**: Cache calculated item heights
- **Pooling**: Reuse DOM elements when possible
- **Smooth Scrolling**: Use CSS transforms for positioning

### Connection Management
```typescript
interface VirtualScrollManager {
  // Viewport management
  updateViewport(scrollTop: number, height: number): void;
  getVisibleItems(): any[];

  // Dynamic loading
  loadMoreItems(): Promise<void>;

  // Performance
  getMetrics(): ScrollMetrics;
}
```

### Error Handling
- **Height Calculation Errors**: Use default height
- **Scroll Jump Prevention**: Maintain scroll position on updates
- **Memory Limits**: Cap total items in memory

### Type Safety
```typescript
interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  visibleStart: number;
  visibleEnd: number;
  overscanStart: number;
  overscanEnd: number;
}

interface ScrollMetrics {
  renderCount: number;
  averageRenderTime: number;
  scrollFPS: number;
  memoryUsage: number;
}
```

---

## 10. Lazy Loading for Off-screen Cards

### Architecture Pattern
**Pattern**: Intersection Observer-based lazy loading
**Strategy**: Progressive enhancement with placeholders

### Component Structure
```typescript
const LazyStreamCard: React.FC<StreamCardProps> = ({ stream }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useIntersectionObserver(cardRef, {
    threshold: 0.1,
    rootMargin: '50px',
    onIntersect: () => setIsVisible(true)
  });

  if (!isVisible) {
    return <CardPlaceholder />;
  }

  return <ActualCard stream={stream} onLoad={() => setIsLoaded(true)} />;
};
```

### Data Flow
```
Initial Render → Show Placeholder → Register Observer
        ↓              ↓                    ↓
   Scroll Event → Check Intersection → Is Visible?
        ↓                                  ↓
   Load Resources ← Render Card ← Trigger Load
```

### Dependencies
- IntersectionObserver API
- Image lazy loading
- Resource prioritization

### Performance Considerations
- **Progressive Loading**: Load critical resources first
- **Image Optimization**: Use appropriate image sizes
- **Placeholder Quality**: Low-quality image placeholders (LQIP)
- **Loading Priority**: Prioritize above-the-fold content

### Connection Management
```typescript
interface LazyLoadManager {
  // Observer management
  observe(element: Element): void;
  unobserve(element: Element): void;

  // Loading control
  prioritizeLoad(elementId: string): void;
  pauseLoading(): void;
  resumeLoading(): void;

  // Metrics
  getLoadedCount(): number;
  getPendingCount(): number;
}
```

### Error Handling
- **Load Failures**: Show error state with retry
- **Slow Networks**: Increase timeout and show progress
- **Observer Failures**: Fall back to scroll-based detection

### Type Safety
```typescript
interface LazyLoadState {
  visibility: 'hidden' | 'visible' | 'loaded';
  loadStarted?: number;
  loadCompleted?: number;
  error?: Error;
  retryCount: number;
}

interface LoadConfig {
  threshold: number; // Intersection threshold
  rootMargin: string; // Expand viewport
  delay?: number; // Delay before loading
  priority?: 'high' | 'normal' | 'low';
}
```

---

## 11. Connection Status Indicator

### Architecture Pattern
**Pattern**: Multi-state connection indicator with diagnostics
**States**: `connected`, `connecting`, `reconnecting`, `error`, `offline`

### Component Structure
```typescript
const ConnectionIndicator: React.FC = () => {
  const { connectionState, latency, quality } = useConnectionStatus();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="connection-indicator">
      <StatusDot state={connectionState} />
      <LatencyBadge latency={latency} />
      {showDetails && <ConnectionDetails quality={quality} />}
    </div>
  );
};
```

### Data Flow
```
WebSocket State → Map to UI State → Determine Color
        ↓              ↓                  ↓
   Monitor Health → Calculate Quality → Show Indicator
        ↓                                    ↓
   Measure Latency ← Track Metrics ← Update Display
```

### Dependencies
- WebSocket connection state
- Performance monitoring
- Network information API

### Performance Considerations
- **Update Frequency**: Throttle updates to 1/second
- **Latency Measurement**: Use moving average
- **CSS Animations**: Pure CSS for status animations
- **Minimal Rerenders**: Memoize indicator component

### Connection Management
```typescript
interface ConnectionMonitor {
  // State tracking
  getState(): ConnectionState;
  getQuality(): ConnectionQuality;

  // Metrics
  getLatency(): number;
  getPacketLoss(): number;
  getUptime(): number;

  // Diagnostics
  runDiagnostics(): Promise<DiagnosticReport>;
}
```

### Error Handling
- **Metric Failures**: Show last known good state
- **Animation Errors**: Degrade to static indicator
- **Diagnostic Failures**: Show partial information

### Type Safety
```typescript
interface ConnectionStatus {
  state: 'connected' | 'connecting' | 'reconnecting' | 'error' | 'offline';
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  latency: number; // milliseconds
  packetLoss: number; // percentage
  lastConnected?: number;
  errorMessage?: string;
}

interface DiagnosticReport {
  timestamp: number;
  connection: ConnectionStatus;
  network: {
    type: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
    effectiveType: '4g' | '3g' | '2g' | 'slow-2g';
    downlink: number; // Mbps
  };
  websocket: {
    readyState: number;
    bufferedAmount: number;
    protocol: string;
  };
}
```

---

## 12. WebSocket Reconnection Testing

### Architecture Pattern
**Pattern**: Automated testing suite with chaos engineering
**Scenarios**: Network loss, server restart, auth expiry, rate limiting

### Component Structure
```typescript
class WebSocketTestHarness {
  private mockWebSocket: MockWebSocket;
  private testScenarios: Map<string, TestScenario>;
  private results: TestResult[];

  runTest(scenario: string): Promise<TestResult>;
  runAllTests(): Promise<TestResult[]>;
  simulateNetworkCondition(condition: NetworkCondition): void;
}
```

### Data Flow
```
Test Scenario → Configure Mock → Trigger Condition
      ↓              ↓                  ↓
   Setup State → Simulate Event → Verify Behavior
      ↓                              ↓
   Collect Metrics ← Assert ← Record Results
```

### Dependencies
- Mock WebSocket implementation
- Test framework (Jest/Vitest)
- Performance monitoring

### Performance Considerations
- **Test Isolation**: Each test in clean environment
- **Parallel Testing**: Run independent tests concurrently
- **Resource Cleanup**: Proper teardown after each test
- **Time Simulation**: Use fake timers for time-based tests

### Connection Management
```typescript
interface TestConfiguration {
  // Network conditions
  latency: number;
  packetLoss: number;
  bandwidth: number;

  // Failure scenarios
  disconnectAfter?: number;
  rejectAuth?: boolean;
  serverError?: boolean;

  // Timing
  reconnectDelay?: number;
  timeoutDuration?: number;
}
```

### Error Handling
- **Test Failures**: Detailed error reports with stack traces
- **Timeout Handling**: Fail tests that exceed time limits
- **Cleanup Errors**: Ensure cleanup even on test failure

### Type Safety
```typescript
interface TestScenario {
  name: string;
  description: string;
  setup: () => void;
  execute: () => Promise<void>;
  verify: () => void;
  teardown: () => void;
  timeout?: number;
}

interface TestResult {
  scenario: string;
  passed: boolean;
  duration: number;
  errors: Error[];
  metrics: {
    reconnectTime?: number;
    messagesSent?: number;
    messagesReceived?: number;
    packetsLost?: number;
  };
}

interface NetworkCondition {
  type: 'offline' | 'slow' | 'flaky' | 'normal';
  config: {
    latency?: { min: number; max: number };
    packetLoss?: number;
    bandwidth?: number;
    jitter?: number;
  };
}
```

---

## Implementation Priority Matrix

### Critical Path (Week 1)
1. **useLiveStreamWebSocket Hook** - Foundation for all features
2. **WebSocket Connection with Auto-reconnect** - Core reliability
3. **Channel Subscription** - Enable real-time updates

### Core Features (Week 2)
4. **Real-time Viewer Count** - Key user-facing metric
5. **Connection Status Indicator** - User feedback
6. **Message Throttling** - Prevent overload

### Enhancement Features (Week 3)
7. **Optimistic Updates** - Improved UX
8. **Status Change Notifications** - User engagement
9. **Presence Tracking** - Social features

### Performance Optimizations (Week 4)
10. **Virtual Scrolling** - Handle large lists
11. **Lazy Loading** - Reduce initial load
12. **Reconnection Testing** - Ensure reliability

---

## Resource Requirements

### Development Resources
- **Senior Frontend Engineer**: 2 weeks full-time
- **WebSocket Specialist**: 1 week consultation
- **QA Engineer**: 1 week testing

### Infrastructure Resources
- **Cloudflare Workers**: Additional 10M requests/month
- **Durable Objects**: 100k WebSocket connections
- **KV Storage**: 10GB for presence data
- **Analytics**: Enhanced monitoring

### Performance Budget
- **JavaScript Bundle**: +50KB max (gzipped)
- **Memory Usage**: +30MB max per tab
- **CPU Usage**: <5% idle, <15% active
- **Network**: 100KB/min per connection

---

## Success Metrics

### Technical Metrics
- **Connection Reliability**: >99.9% uptime
- **Reconnection Time**: <2 seconds (P95)
- **Message Latency**: <100ms (P95)
- **Update Frequency**: 10 updates/second max

### User Experience Metrics
- **Time to First Update**: <500ms
- **Smooth Animation**: 60fps
- **Error Recovery**: Transparent to user
- **Resource Efficiency**: No memory leaks

### Business Metrics
- **User Engagement**: +30% time on platform
- **Stream Discovery**: +25% stream clicks
- **Viewer Retention**: +20% during streams
- **Feature Adoption**: 80% of users

---

## Risk Mitigation

### Technical Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|------------|------------|
| WebSocket Overload | High | Medium | Rate limiting, queue management |
| Memory Leaks | High | Low | Cleanup handlers, monitoring |
| Network Instability | Medium | High | Reconnection logic, buffering |
| Browser Compatibility | Low | Low | Polyfills, progressive enhancement |

### Mitigation Strategies
1. **Gradual Rollout**: Start with 10% of users
2. **Feature Flags**: Toggle features without deployment
3. **Monitoring**: Real-time alerts for anomalies
4. **Fallback Modes**: Polling when WebSocket fails
5. **Load Testing**: Simulate 10x expected load

---

## Conclusion

These architectural specifications provide a comprehensive blueprint for implementing Phase 3 real-time features. The design prioritizes:

1. **Reliability**: Robust error handling and reconnection
2. **Performance**: Optimized for minimal resource usage
3. **Scalability**: Designed to handle growth
4. **Maintainability**: Clear patterns and type safety

Following these specifications will result in a production-ready real-time system that enhances user engagement while maintaining platform stability.