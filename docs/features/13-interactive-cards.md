# Feature Implementation Plan: Interactive Cards

**Feature Number**: 13
**Priority**: MEDIUM
**Complexity**: Medium-Complex (3-4 weeks)
**Dependencies**: Video Player, Analytics System
**Document Version**: 1.0
**Last Updated**: 2025-11-20

---

## Executive Summary

Interactive Cards allow creators to add clickable elements during video playback, enhancing engagement and providing contextual information at specific timestamps. Cards appear as overlays during video playback (not just at the end like End Screens), supporting multiple card types including video/playlist recommendations, polls, external links, and channel promotion.

**Key Benefits**:
- Increase viewer engagement with interactive elements
- Drive traffic to related content during playback
- Enable mid-video CTAs for donations or subscriptions
- Collect viewer feedback through polls
- Provide contextual references at relevant timestamps

---

## Requirements Analysis

### Functional Requirements

**From YouTube Comparison Document**:
1. Cards appear during video playback (not just at end)
2. Support multiple card types:
   - Video/Playlist card
   - Poll card (voting)
   - Link card (external URL - approved channels only)
   - Channel card
3. Set timing for each card (at specific timestamp)
4. Teaser text appears in top-right corner
5. Click to expand full card
6. Up to 5 cards per video
7. Click tracking for analytics

### Non-Functional Requirements

1. **Performance**:
   - Card rendering must not impact video playback performance
   - Lazy load card content to minimize initial load
   - Smooth animations (<16ms frame time)

2. **Accessibility**:
   - Keyboard navigation support
   - Screen reader announcements
   - WCAG 2.1 AA compliance
   - RTL support for Arabic interface

3. **Security**:
   - Validate external URLs against allowlist
   - Sanitize all user-generated content
   - Rate limit poll submissions
   - JWT authentication for voting

4. **Scalability**:
   - Support millions of card interactions
   - Efficient storage and retrieval
   - CDN-compatible card data

---

## Technical Architecture

### Data Model Design

```typescript
// packages/shared-types/src/cards.ts

export enum CardType {
  VIDEO = 'video',
  PLAYLIST = 'playlist',
  POLL = 'poll',
  LINK = 'link',
  CHANNEL = 'channel'
}

export interface BaseCard {
  id: string;
  type: CardType;
  videoId: string;

  // Timing
  startTime: number;  // Seconds from video start
  duration: number;   // How long card is visible (default: 7 seconds)

  // Display
  teaserText: string; // Max 30 characters
  position?: CardPosition;

  // Tracking
  impressions?: number;
  clicks?: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface VideoCard extends BaseCard {
  type: CardType.VIDEO;
  targetVideoId: string;
  targetVideoTitle: string;
  targetVideoThumbnail: string;
  targetVideoDuration?: number;
  targetVideoChannel?: string;
}

export interface PlaylistCard extends BaseCard {
  type: CardType.PLAYLIST;
  targetPlaylistId: string;
  targetPlaylistTitle: string;
  targetPlaylistThumbnail: string;
  targetPlaylistVideoCount: number;
}

export interface PollCard extends BaseCard {
  type: CardType.POLL;
  question: string;
  options: PollOption[];
  allowMultipleChoices: boolean;
  showResults: boolean;
  resultsDelay?: number; // Seconds before showing results
  totalVotes?: number;
}

export interface PollOption {
  id: string;
  text: string;
  votes?: number;
  percentage?: number;
}

export interface LinkCard extends BaseCard {
  type: CardType.LINK;
  url: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  domain: string;
  isApproved: boolean; // Requires channel verification
}

export interface ChannelCard extends BaseCard {
  type: CardType.CHANNEL;
  targetChannelId: string;
  targetChannelName: string;
  targetChannelAvatar: string;
  targetChannelDescription?: string;
  targetChannelSubscribers?: number;
}

export type InteractiveCard =
  | VideoCard
  | PlaylistCard
  | PollCard
  | LinkCard
  | ChannelCard;

export interface CardPosition {
  vertical: 'top' | 'center' | 'bottom';
  horizontal: 'left' | 'center' | 'right';
}

export interface CardInteraction {
  id: string;
  cardId: string;
  userId: string;
  type: 'impression' | 'click' | 'vote' | 'dismiss';
  metadata?: Record<string, any>; // For poll votes, etc.
  timestamp: string;
  sessionId: string;
}

export interface CardsConfiguration {
  videoId: string;
  cards: InteractiveCard[];
  enabled: boolean;
  lastModified: string;
  modifiedBy: string;
}
```

### Storage Strategy

**Primary Storage (R2)**:
```
Bucket: al-ummah-now-cards
Structure:
  /videos/{videoId}/config.json     # Cards configuration
  /videos/{videoId}/cards/{cardId}.json  # Individual card data
  /analytics/{date}/interactions.json    # Daily interaction logs
  /polls/{pollId}/votes.json            # Poll votes storage
```

**Cache Layer (KV)**:
```
Keys:
  cards:{videoId}:config    # Cached configuration (TTL: 5 min)
  cards:{cardId}:data       # Individual card cache
  polls:{pollId}:results    # Poll results cache (TTL: 30 sec)
  cards:stats:{videoId}     # Aggregated stats
```

---

## Component Architecture

### 1. Card Editor Component

```typescript
// apps/web/src/components/CardEditor/index.tsx

interface CardEditorProps {
  videoId: string;
  videoDuration: number;
  existingCards?: InteractiveCard[];
  onSave: (cards: InteractiveCard[]) => void;
}

const CardEditor: React.FC<CardEditorProps> = ({
  videoId,
  videoDuration,
  existingCards = [],
  onSave
}) => {
  // Timeline visualization with drag-and-drop
  // Card type selector
  // Card content editor
  // Preview mode
  // Validation (max 5 cards, no overlaps)
}
```

**Key Features**:
- Visual timeline showing video duration
- Drag-and-drop to position cards on timeline
- Card type selector with templates
- Live preview of card appearance
- Collision detection (prevent overlapping cards)
- Bulk operations (delete all, copy timing)
- Import/export card configurations

### 2. Timeline Component

```typescript
// apps/web/src/components/CardEditor/Timeline.tsx

interface TimelineProps {
  duration: number;
  cards: InteractiveCard[];
  currentTime?: number;
  onCardMove: (cardId: string, newTime: number) => void;
  onCardSelect: (cardId: string) => void;
  onTimeSeek: (time: number) => void;
}

const Timeline: React.FC<TimelineProps> = ({...}) => {
  // Visual timeline with zoom controls
  // Card blocks showing timing
  // Playhead indicator
  // Time ruler with markers
  // Snap-to-grid functionality
}
```

### 3. Card Templates

```typescript
// apps/web/src/components/CardEditor/templates/

// VideoCardTemplate.tsx
// PlaylistCardTemplate.tsx
// PollCardTemplate.tsx
// LinkCardTemplate.tsx
// ChannelCardTemplate.tsx

// Each template provides:
// - Form fields for card-specific data
// - Validation rules
// - Preview rendering
// - Default values
```

### 4. Video Player Overlay System

```typescript
// apps/web/src/components/VideoPlayer/CardOverlay.tsx

interface CardOverlayProps {
  cards: InteractiveCard[];
  currentTime: number;
  onCardClick: (card: InteractiveCard) => void;
  onCardImpression: (card: InteractiveCard) => void;
  isRTL: boolean;
}

const CardOverlay: React.FC<CardOverlayProps> = ({...}) => {
  // Card teaser rendering (top-right corner)
  // Expanded card modal
  // Animation transitions
  // Click/tap handling
  // Auto-dismiss timer
}
```

### 5. Card Display Components

```typescript
// apps/web/src/components/VideoPlayer/Cards/

// CardTeaser.tsx - Small preview in corner
interface CardTeaserProps {
  card: InteractiveCard;
  onClick: () => void;
  position: 'top-right' | 'top-left';
}

// ExpandedCard.tsx - Full card display
interface ExpandedCardProps {
  card: InteractiveCard;
  onClose: () => void;
  onAction: (action: CardAction) => void;
}

// Individual card renderers
// VideoCardDisplay.tsx
// PlaylistCardDisplay.tsx
// PollCardDisplay.tsx
// LinkCardDisplay.tsx
// ChannelCardDisplay.tsx
```

---

## API Endpoints

### Card Management

```typescript
// apps/api-videos/src/endpoints/cards/

// GET /api/videos/{videoId}/cards
// Retrieve all cards for a video
interface GetCardsResponse {
  cards: InteractiveCard[];
  enabled: boolean;
}

// POST /api/videos/{videoId}/cards
// Create or update cards configuration
interface CreateCardsRequest {
  cards: Omit<InteractiveCard, 'id' | 'createdAt' | 'updatedAt'>[];
}

// PUT /api/videos/{videoId}/cards/{cardId}
// Update individual card
interface UpdateCardRequest {
  card: Partial<InteractiveCard>;
}

// DELETE /api/videos/{videoId}/cards/{cardId}
// Delete individual card

// POST /api/videos/{videoId}/cards/reorder
// Reorder cards or adjust timing
interface ReorderCardsRequest {
  cardOrders: Array<{
    cardId: string;
    startTime: number;
  }>;
}
```

### Poll Management

```typescript
// POST /api/cards/{cardId}/poll/vote
// Submit poll vote
interface PollVoteRequest {
  optionIds: string[];
  userId?: string; // Optional for anonymous voting
}

// GET /api/cards/{cardId}/poll/results
// Get poll results
interface PollResultsResponse {
  totalVotes: number;
  options: Array<{
    id: string;
    text: string;
    votes: number;
    percentage: number;
  }>;
  userVoted?: boolean;
  userVotes?: string[]; // Option IDs user voted for
}
```

### Analytics

```typescript
// POST /api/cards/{cardId}/interactions
// Track card interactions
interface TrackInteractionRequest {
  type: 'impression' | 'click' | 'dismiss';
  timestamp: number;
  metadata?: Record<string, any>;
}

// GET /api/videos/{videoId}/cards/analytics
// Get aggregated analytics
interface CardAnalyticsResponse {
  totalImpressions: number;
  totalClicks: number;
  clickThroughRate: number;
  cardMetrics: Array<{
    cardId: string;
    impressions: number;
    clicks: number;
    ctr: number;
  }>;
}
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**1. Data Models & Storage**
- [ ] Create card TypeScript types in shared-types
- [ ] Set up R2 bucket for cards storage
- [ ] Create KV namespace for caching
- [ ] Design database schema for analytics

**2. Basic API Endpoints**
- [ ] Implement CRUD operations for cards
- [ ] Add validation middleware
- [ ] Set up OpenAPI documentation
- [ ] Create test fixtures

**3. Security & Permissions**
- [ ] Implement card creation permissions
- [ ] Add URL validation for link cards
- [ ] Set up rate limiting for polls
- [ ] Create approval workflow for external links

### Phase 2: Editor Components (Week 2)

**1. Card Editor UI**
- [ ] Build timeline component with drag-and-drop
- [ ] Create card type selector
- [ ] Implement card templates for each type
- [ ] Add form validation

**2. Card Preview System**
- [ ] Build preview renderer
- [ ] Add real-time preview updates
- [ ] Implement responsive design
- [ ] Add RTL support

**3. Editor Integration**
- [ ] Integrate with video upload flow
- [ ] Add to video edit page
- [ ] Create save/autosave functionality
- [ ] Add import/export features

### Phase 3: Player Integration (Week 3)

**1. Overlay System**
- [ ] Build card overlay component
- [ ] Implement timing logic
- [ ] Add animation transitions
- [ ] Create dismiss handlers

**2. Card Rendering**
- [ ] Build teaser component
- [ ] Create expanded card views
- [ ] Implement card-specific renderers
- [ ] Add mobile optimizations

**3. Interaction Handling**
- [ ] Implement click tracking
- [ ] Add impression tracking
- [ ] Create poll voting system
- [ ] Build analytics collection

### Phase 4: Polish & Testing (Week 4)

**1. Performance Optimization**
- [ ] Implement lazy loading
- [ ] Add request batching
- [ ] Optimize animations
- [ ] Add caching strategies

**2. Testing**
- [ ] Unit tests for components
- [ ] Integration tests for API
- [ ] E2E tests for user flows
- [ ] Performance testing

**3. Documentation & Rollout**
- [ ] Create user documentation
- [ ] Add feature flags
- [ ] Set up monitoring
- [ ] Plan phased rollout

---

## Files to Create/Modify

### New Files to Create

**Shared Types**:
```
packages/shared-types/src/
├── cards.ts                 # Card type definitions
└── index.ts                 # Export cards types
```

**API Layer**:
```
apps/api-videos/src/
├── endpoints/
│   └── cards/
│       ├── index.ts         # Card endpoints router
│       ├── getCards.ts      # Retrieve cards
│       ├── createCards.ts   # Create/update cards
│       ├── deleteCard.ts    # Delete card
│       ├── pollVote.ts      # Handle poll voting
│       └── analytics.ts     # Track interactions
├── repositories/
│   └── CardsRepository.ts   # R2 storage operations
└── lib/
    └── cards/
        ├── validator.ts     # Card validation rules
        ├── permissions.ts   # Permission checks
        └── analytics.ts     # Analytics processing
```

**Frontend Components**:
```
apps/web/src/components/
├── CardEditor/
│   ├── index.tsx           # Main editor component
│   ├── Timeline.tsx        # Timeline visualization
│   ├── CardForm.tsx        # Card content form
│   ├── templates/
│   │   ├── VideoCard.tsx
│   │   ├── PlaylistCard.tsx
│   │   ├── PollCard.tsx
│   │   ├── LinkCard.tsx
│   │   └── ChannelCard.tsx
│   └── styles.module.css
└── VideoPlayer/
    ├── CardOverlay.tsx     # Overlay container
    ├── Cards/
    │   ├── CardTeaser.tsx
    │   ├── ExpandedCard.tsx
    │   ├── VideoCardDisplay.tsx
    │   ├── PlaylistCardDisplay.tsx
    │   ├── PollCardDisplay.tsx
    │   ├── LinkCardDisplay.tsx
    │   └── ChannelCardDisplay.tsx
    └── cards.module.css
```

**Hooks & Utilities**:
```
apps/web/src/
├── hooks/
│   ├── useCards.ts         # Card data fetching
│   ├── useCardTracking.ts  # Analytics tracking
│   └── usePollVoting.ts    # Poll interaction
└── lib/
    └── cards/
        ├── client.ts       # API client
        ├── utils.ts        # Helper functions
        └── constants.ts    # Card constraints
```

### Files to Modify

**Video Model**:
```typescript
// packages/shared-types/src/video.ts
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Interactive features
  hasCards?: boolean;
  cardsCount?: number;
  lastCardsUpdate?: string;
}
```

**Video Player**:
```typescript
// apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx
// Add CardOverlay component
// Pass current time to overlay
// Handle card interactions
```

**Video Upload/Edit**:
```typescript
// apps/web/src/app/[locale]/video/[id]/edit/page.tsx
// Add Cards tab to edit interface
// Integrate CardEditor component
```

**API Routes**:
```typescript
// apps/api-videos/src/index.ts
// Register card endpoints
// Add to OpenAPI documentation
```

---

## Testing Strategy

### Unit Tests

**Component Tests**:
```typescript
// CardEditor.test.tsx
- Timeline drag and drop
- Card validation
- Max cards limit
- Time overlap detection

// CardOverlay.test.tsx
- Card visibility timing
- Click tracking
- Animation performance
- RTL rendering

// Card Templates
- Form validation
- Data transformation
- Preview rendering
```

**API Tests**:
```typescript
// cards.test.ts
- CRUD operations
- Permission checks
- Validation rules
- Rate limiting

// polls.test.ts
- Vote submission
- Duplicate vote prevention
- Results calculation
- Anonymous voting
```

### Integration Tests

```typescript
// Card Creation Flow
- Upload video
- Add cards in editor
- Save configuration
- Verify in player

// Poll Interaction Flow
- Display poll card
- Submit vote
- View results
- Track analytics

// Analytics Flow
- Track impressions
- Track clicks
- Aggregate data
- Generate reports
```

### E2E Tests

```typescript
// Creator Journey
1. Upload video
2. Open card editor
3. Add multiple card types
4. Preview cards
5. Save and publish
6. Verify in live video

// Viewer Journey
1. Watch video
2. See card teaser
3. Click to expand
4. Interact with card
5. Vote in poll
6. Navigate to linked content
```

### Performance Tests

- Card rendering with 5 simultaneous cards
- Timeline with 100+ videos in playlist card
- Poll with 10,000+ votes
- Analytics with millions of interactions
- Player performance with cards enabled

---

## Security Considerations

### Input Validation

1. **Card Content**:
   - Sanitize HTML in descriptions
   - Validate URLs against allowlist
   - Check file sizes for thumbnails
   - Enforce character limits

2. **Timing Validation**:
   - Ensure startTime < video duration
   - Prevent negative timestamps
   - Validate duration limits
   - Check for overlapping cards

3. **Poll Security**:
   - Rate limit voting (1 vote per user per poll)
   - Prevent vote manipulation
   - Validate option IDs
   - Secure results calculation

### Permission Model

```typescript
enum CardPermission {
  CREATE_CARDS = 'cards:create',        // Create cards on own videos
  EDIT_CARDS = 'cards:edit',            // Edit existing cards
  DELETE_CARDS = 'cards:delete',        // Delete cards
  CREATE_EXTERNAL_LINKS = 'cards:external', // Add external link cards
  VIEW_ANALYTICS = 'cards:analytics',   // View card analytics
  MODERATE_POLLS = 'cards:moderate'     // Moderate poll content
}
```

### Data Privacy

1. **Analytics Collection**:
   - Anonymous by default
   - User consent for tracking
   - GDPR compliance
   - Data retention policies

2. **Poll Voting**:
   - Optional anonymous voting
   - Encrypted vote storage
   - No PII in public results
   - Vote history privacy

---

## Accessibility Requirements

### WCAG 2.1 AA Compliance

1. **Keyboard Navigation**:
   - Tab through cards
   - Enter to expand
   - Escape to dismiss
   - Arrow keys in timeline

2. **Screen Reader Support**:
   - ARIA labels for all cards
   - Announce card appearance
   - Read poll results
   - Navigation instructions

3. **Visual Design**:
   - High contrast mode
   - Focus indicators
   - Readable fonts
   - Sufficient tap targets

### RTL Support

1. **Layout Adjustments**:
   - Mirror card positions
   - Reverse timeline direction
   - Flip animations
   - RTL text alignment

2. **Testing**:
   - Arabic interface testing
   - Bidirectional text support
   - Number formatting
   - Date formatting

---

## Performance Optimization

### Loading Strategy

1. **Lazy Loading**:
   - Load card data on demand
   - Defer non-visible cards
   - Progressive image loading
   - Code splitting for editor

2. **Caching**:
   - Cache card configurations (5 min)
   - Cache poll results (30 sec)
   - CDN for static assets
   - Browser caching

3. **Request Optimization**:
   - Batch analytics requests
   - Debounce interactions
   - Compress payloads
   - Use WebSocket for polls

### Rendering Optimization

1. **Animation Performance**:
   - Use CSS transforms
   - GPU acceleration
   - RequestAnimationFrame
   - Reduce reflows

2. **Memory Management**:
   - Clean up event listeners
   - Dispose unused cards
   - Limit DOM nodes
   - Virtualize long lists

---

## Monitoring & Analytics

### Key Metrics

**Engagement Metrics**:
- Card impression rate
- Click-through rate (CTR)
- Average interaction time
- Poll participation rate
- Card dismissal rate

**Performance Metrics**:
- Card load time
- Animation frame rate
- API response time
- Error rate
- Cache hit rate

**Business Metrics**:
- Videos with cards enabled
- Average cards per video
- Most popular card types
- Conversion rates (subscriptions, video views)
- Creator adoption rate

### Monitoring Setup

```typescript
// Cloudflare Analytics
track('card.impression', {
  cardId,
  cardType,
  videoId,
  timestamp,
  position
});

track('card.click', {
  cardId,
  cardType,
  targetUrl,
  videoId,
  timestamp
});

track('poll.vote', {
  pollId,
  optionId,
  isAnonymous,
  videoId
});
```

---

## Migration & Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Deploy to staging environment
- Internal team testing
- Fix critical bugs
- Performance baseline

### Phase 2: Beta Launch (Week 2-3)
- Feature flag for 10% of creators
- Collect feedback
- Monitor performance
- Iterate on UX

### Phase 3: General Availability (Week 4)
- Enable for all creators
- Public announcement
- Documentation release
- Support training

### Rollback Plan
- Feature flag for quick disable
- Data export capability
- Clear communication channels
- Backup of configurations

---

## Success Criteria

### Technical Success
- [ ] All card types functional
- [ ] <100ms card load time
- [ ] 60fps animations
- [ ] Zero data loss
- [ ] 99.9% uptime

### User Success
- [ ] 20% of videos use cards within 3 months
- [ ] 5% average CTR on cards
- [ ] 15% poll participation rate
- [ ] Positive creator feedback (>4.0/5.0)
- [ ] Increased session duration by 10%

### Business Success
- [ ] Increased video-to-video navigation by 25%
- [ ] Higher subscription conversion from channel cards
- [ ] Improved content discovery
- [ ] Enhanced creator tools adoption

---

## Open Questions & Decisions

### Technical Decisions
1. Should we use WebSocket for real-time poll results?
2. How to handle card conflicts with end screens?
3. Should cards pause video on expansion?
4. Maximum poll options (5, 10, or unlimited)?

### Product Decisions
1. Should link cards require channel verification?
2. Allow cards on live streams?
3. Card availability for all creators or tiered?
4. Should viewers be able to disable cards?

### Implementation Priorities
1. Which card type to implement first?
2. Desktop vs mobile priority?
3. Editor complexity vs ease of use?
4. Analytics depth vs privacy?

---

## Risks & Mitigations

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance degradation | High | Lazy loading, caching, monitoring |
| Data loss | High | Backups, versioning, audit logs |
| Browser compatibility | Medium | Progressive enhancement, polyfills |
| Scale issues | Medium | CDN, pagination, rate limiting |

### Product Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Low adoption | High | Creator education, templates, incentives |
| User annoyance | High | Frequency limits, user controls, quality guidelines |
| Spam/abuse | Medium | Moderation, reporting, automated detection |
| Complexity | Medium | Progressive disclosure, tutorials, templates |

---

## Dependencies

### External Dependencies
- Video player library (Video.js or similar)
- R2 storage for card data
- KV store for caching
- CDN for assets
- Analytics service

### Internal Dependencies
- Authentication system (JWT)
- Video upload system
- Analytics pipeline
- Permissions system
- i18n framework

---

## Documentation Requirements

### User Documentation
1. Creator guide for adding cards
2. Best practices for card timing
3. Card type selection guide
4. Analytics interpretation
5. Troubleshooting guide

### Developer Documentation
1. API reference
2. Component documentation
3. Integration guide
4. Testing procedures
5. Deployment guide

---

## Future Enhancements

### Version 2.0 Features
1. **AI-Powered Suggestions**:
   - Auto-suggest card placement
   - Content recommendations
   - Optimal timing predictions

2. **Advanced Card Types**:
   - Product cards (e-commerce)
   - Donation cards
   - Quiz cards
   - Form cards

3. **Enhanced Analytics**:
   - A/B testing for cards
   - Heatmaps for click patterns
   - Conversion funnel analysis
   - Cohort analysis

4. **Creator Tools**:
   - Card templates marketplace
   - Bulk card management
   - Cross-video card copying
   - Card scheduling

5. **Viewer Personalization**:
   - Personalized card content
   - Language-specific cards
   - Geographic targeting
   - Interest-based filtering

---

## Conclusion

Interactive Cards represent a significant enhancement to the Al Ummah Now platform, providing creators with powerful tools to engage viewers and drive meaningful interactions during video playback. The implementation plan balances technical complexity with user experience, ensuring a robust, scalable, and accessible feature that aligns with the platform's Islamic content focus.

The phased approach allows for iterative development and testing, minimizing risk while maximizing learning opportunities. With proper execution, Interactive Cards can significantly improve viewer engagement, content discovery, and creator satisfaction on the platform.

---

## Appendix

### A. Mock Data Examples

```json
// Video Card Example
{
  "id": "card_video_001",
  "type": "video",
  "videoId": "video_123",
  "startTime": 45,
  "duration": 7,
  "teaserText": "Watch next: Advanced Tajweed",
  "targetVideoId": "video_456",
  "targetVideoTitle": "Advanced Tajweed Rules Explained",
  "targetVideoThumbnail": "https://cdn.example.com/thumb.jpg",
  "targetVideoDuration": 1200,
  "targetVideoChannel": "Quran Academy"
}

// Poll Card Example
{
  "id": "card_poll_001",
  "type": "poll",
  "videoId": "video_123",
  "startTime": 120,
  "duration": 10,
  "teaserText": "Quick question",
  "question": "Which topic should we cover next?",
  "options": [
    { "id": "opt1", "text": "Fiqh of Salah", "votes": 245, "percentage": 45 },
    { "id": "opt2", "text": "Tafsir of Surah Yaseen", "votes": 189, "percentage": 35 },
    { "id": "opt3", "text": "Stories of the Prophets", "votes": 108, "percentage": 20 }
  ],
  "allowMultipleChoices": false,
  "showResults": true,
  "totalVotes": 542
}
```

### B. UI Mockups

```
Timeline Editor:
┌─────────────────────────────────────────────────────┐
│ 0:00 ─────[Card1]───────[Card2]──────[Card3]─── 5:00│
│      ▲ Drag to reposition                           │
└─────────────────────────────────────────────────────┘

Card Teaser (top-right corner):
┌──────────────┐
│ 📝 Quick Poll │
│  Click to vote│
└──────────────┘

Expanded Poll Card:
┌─────────────────────────────────────┐
│ Which topic should we cover next?   │
│                                      │
│ ○ Fiqh of Salah              (45%)  │
│ ○ Tafsir of Surah Yaseen     (35%)  │
│ ○ Stories of the Prophets    (20%)  │
│                                      │
│ [Submit Vote]            542 votes  │
└─────────────────────────────────────┘
```

### C. Performance Benchmarks

| Metric | Target | Acceptable | Current |
|--------|--------|------------|---------|
| Card Load Time | <50ms | <100ms | N/A |
| Animation FPS | 60fps | 30fps | N/A |
| Click Response | <100ms | <200ms | N/A |
| Poll Submit | <500ms | <1000ms | N/A |
| Analytics Batch | <1000ms | <2000ms | N/A |

---

**Document Status**: APPROVED FOR IMPLEMENTATION
**Next Review Date**: 2025-12-20
**Owner**: Development Team
**Stakeholders**: Product, Design, Engineering, QA