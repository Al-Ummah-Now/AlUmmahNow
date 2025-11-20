# End Screens Implementation Plan

**Feature**: End Screens (Video Overlay Elements)
**Priority**: HIGH
**Impact**: Drives engagement and session time
**Estimated Effort**: 3 weeks (2 developers)
**Document Version**: 1.0
**Created**: 2025-01-20

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Data Model](#data-model)
4. [System Architecture](#system-architecture)
5. [API Design](#api-design)
6. [UI Components](#ui-components)
7. [Video Player Integration](#video-player-integration)
8. [Templates System](#templates-system)
9. [Technical Implementation Details](#technical-implementation-details)
10. [Files to Create/Modify](#files-to-createmodify)
11. [Testing Strategy](#testing-strategy)
12. [Migration Plan](#migration-plan)
13. [Performance Considerations](#performance-considerations)
14. [Security & Validation](#security--validation)
15. [Implementation Checklist](#implementation-checklist)

---

## Overview

End screens are interactive elements that appear during the last 5-20 seconds of a video to drive viewer engagement and increase session time. They can contain video/playlist recommendations, subscribe buttons, channel links, and external links (for approved channels).

### Business Goals

- **Increase Session Time**: Keep viewers watching more content
- **Grow Subscriptions**: Promote channel subscriptions
- **Cross-Promote Content**: Direct viewers to related videos/playlists
- **Call-to-Action**: Guide viewers to specific actions (donate, visit website)

### User Benefits

- **Content Discovery**: Find related videos easily
- **Series Navigation**: Continue watching next episode
- **Channel Discovery**: Explore more from the creator
- **Easy Subscription**: One-click subscribe without leaving video

---

## Requirements

### Functional Requirements

1. **End Screen Editor**
   - Drag-and-drop interface for placing elements
   - Visual timeline showing last 20 seconds
   - Preview mode before saving
   - Grid snapping for alignment
   - Element resize handles
   - Undo/redo functionality

2. **Element Types**
   - Video recommendation (single video)
   - Playlist recommendation
   - Subscribe button
   - Channel link
   - External link (approved channels only)
   - Custom text/image (future)

3. **Timing Control**
   - Elements appear between 5-20 seconds before video end
   - Individual timing for each element
   - Fade-in/fade-out animations
   - Minimum display duration (3 seconds)

4. **Templates**
   - Pre-designed layouts (2x2 grid, sidebar, corner)
   - Save custom templates
   - Apply template to multiple videos
   - Default template per channel

5. **Player Integration**
   - Overlay elements on video player
   - Mobile responsive layout
   - Click tracking for analytics
   - Accessibility support (keyboard navigation)

### Non-Functional Requirements

- **Performance**: End screens must load without affecting video playback
- **Mobile Support**: Touch-friendly interface, responsive layouts
- **RTL Support**: Proper layout for Arabic content
- **Accessibility**: WCAG 2.1 AA compliance
- **Analytics**: Track impressions and clicks

---

## Data Model

### EndScreen Type (New)

```typescript
// packages/shared-types/src/end-screen.ts

export interface EndScreenElement {
  id: string;
  type: 'video' | 'playlist' | 'subscribe' | 'channel' | 'link';

  // Positioning (percentage-based for responsive)
  position: {
    x: number; // 0-100% from left
    y: number; // 0-100% from top
    width: number; // 10-30% of player width
    height: number; // 10-30% of player height
  };

  // Timing (seconds from end)
  timing: {
    startTime: number; // 5-20 seconds from end
    endTime: number; // 0-15 seconds from end
    fadeIn?: number; // Animation duration in ms
    fadeOut?: number; // Animation duration in ms
  };

  // Element-specific data
  data: VideoElementData | PlaylistElementData | SubscribeElementData | ChannelElementData | LinkElementData;

  // Styling
  style?: {
    backgroundColor?: string;
    borderRadius?: number;
    borderColor?: string;
    borderWidth?: number;
    shadow?: boolean;
  };

  // Metadata
  clickCount?: number;
  impressionCount?: number;
}

export interface VideoElementData {
  videoId: string;
  title?: string; // Optional override
  thumbnailUrl?: string; // Optional custom thumbnail
  duration?: number; // For display
}

export interface PlaylistElementData {
  playlistId: string;
  title?: string;
  thumbnailUrl?: string;
  videoCount?: number;
}

export interface SubscribeElementData {
  channelId: string;
  channelName: string;
  subscriberCount?: number;
  avatarUrl?: string;
  buttonText?: string; // Localized
}

export interface ChannelElementData {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

export interface LinkElementData {
  url: string;
  title: string;
  description?: string;
  iconUrl?: string;
  approved: boolean; // Must be approved for external links
}

export interface EndScreenConfiguration {
  videoId: string;
  elements: EndScreenElement[];
  templateId?: string; // Reference to template used
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;

  // Analytics
  totalImpressions?: number;
  totalClicks?: number;
  avgViewDuration?: number; // How long end screens were visible
}

export interface EndScreenTemplate {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;

  // Template configuration
  elements: Omit<EndScreenElement, 'data'>[]; // Position and timing only

  // Metadata
  thumbnailUrl?: string; // Preview image
  category: 'grid' | 'sidebar' | 'corner' | 'custom';
  isDefault?: boolean; // Channel default template
  isPublic?: boolean; // Available to all users

  // Ownership
  creatorId?: string;
  channelId?: string;

  // Usage stats
  usageCount?: number;

  createdAt: string;
  updatedAt: string;
}
```

### Update Video Type

```typescript
// packages/shared-types/src/video.ts

export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // End screen configuration
  endScreen?: {
    enabled: boolean;
    configId?: string; // Reference to EndScreenConfiguration
    templateId?: string; // Template used
    elementCount?: number; // Quick reference
  };

  // ... rest of existing fields ...
}
```

---

## System Architecture

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           End Screen Editor Component             │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  • DragDropCanvas   • ElementPicker              │   │
│  │  • Timeline         • TemplateSelector           │   │
│  │  • Preview          • SaveHandler                │   │
│  └──────────────────────────────────────────────────┘   │
│                           │                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Video Player End Screen Overlay           │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  • ElementRenderer  • ClickHandler               │   │
│  │  • AnimationEngine  • AnalyticsTracker          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                    HTTP/API
                       │
┌──────────────────────┴──────────────────────────────────┐
│                  API (Hono + Cloudflare)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              End Screen Endpoints                 │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  • GET    /videos/:id/end-screen                 │   │
│  │  • PUT    /videos/:id/end-screen                 │   │
│  │  • DELETE /videos/:id/end-screen                 │   │
│  │  • POST   /videos/:id/end-screen/analytics       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            Template Endpoints                     │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  • GET    /end-screen-templates                  │   │
│  │  • POST   /end-screen-templates                  │   │
│  │  • PUT    /end-screen-templates/:id              │   │
│  │  • DELETE /end-screen-templates/:id              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                    Storage
                       │
┌──────────────────────┴──────────────────────────────────┐
│                   Cloudflare R2 Buckets                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  • end-screens/       (EndScreenConfiguration JSON)     │
│  • end-screen-templates/ (Template definitions)         │
│  • end-screen-analytics/ (Click/impression data)        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Editor Flow**
   ```
   User → Editor UI → Validate → API → R2 Storage
   ```

2. **Player Flow**
   ```
   Video Load → Fetch End Screen → Render at Timing → Track Click → Analytics
   ```

3. **Template Flow**
   ```
   Select Template → Apply to Editor → Customize → Save Configuration
   ```

---

## API Design

### End Screen Configuration Endpoints

#### 1. Get End Screen Configuration

```typescript
// GET /api/videos/:videoId/end-screen
{
  success: true,
  data: {
    videoId: string,
    elements: EndScreenElement[],
    templateId?: string,
    isEnabled: boolean,
    createdAt: string,
    updatedAt: string
  }
}
```

#### 2. Update End Screen Configuration

```typescript
// PUT /api/videos/:videoId/end-screen
// Request Body:
{
  elements: EndScreenElement[],
  templateId?: string,
  isEnabled: boolean
}

// Response:
{
  success: true,
  message: "End screen updated successfully"
}
```

#### 3. Delete End Screen Configuration

```typescript
// DELETE /api/videos/:videoId/end-screen
{
  success: true,
  message: "End screen removed"
}
```

#### 4. Track End Screen Analytics

```typescript
// POST /api/videos/:videoId/end-screen/analytics
// Request Body:
{
  elementId: string,
  event: 'impression' | 'click',
  timestamp: number,
  userId?: string
}

// Response:
{
  success: true
}
```

### Template Endpoints

#### 1. List Templates

```typescript
// GET /api/end-screen-templates?channelId=xxx&category=grid
{
  success: true,
  data: EndScreenTemplate[],
  pagination: {
    cursor: string,
    hasMore: boolean
  }
}
```

#### 2. Create Template

```typescript
// POST /api/end-screen-templates
// Request Body:
{
  name: string,
  nameLocalized?: Record<string, string>,
  elements: Omit<EndScreenElement, 'data'>[],
  category: string,
  isDefault?: boolean
}

// Response:
{
  success: true,
  data: {
    id: string,
    ...template
  }
}
```

#### 3. Update Template

```typescript
// PUT /api/end-screen-templates/:templateId
// Similar to create
```

#### 4. Delete Template

```typescript
// DELETE /api/end-screen-templates/:templateId
{
  success: true,
  message: "Template deleted"
}
```

---

## UI Components

### 1. End Screen Editor Component

```typescript
// apps/web/src/components/EndScreenEditor/index.tsx

interface EndScreenEditorProps {
  videoId: string;
  videoDuration: number;
  currentConfig?: EndScreenConfiguration;
  onSave: (config: EndScreenConfiguration) => Promise<void>;
  lang: 'en' | 'ar';
}

export function EndScreenEditor({
  videoId,
  videoDuration,
  currentConfig,
  onSave,
  lang
}: EndScreenEditorProps) {
  // State
  const [elements, setElements] = useState<EndScreenElement[]>([]);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(videoDuration - 10);
  const [isDirty, setIsDirty] = useState(false);

  // Features:
  // - Drag and drop canvas with grid snapping
  // - Element picker sidebar
  // - Timeline scrubber (last 20 seconds)
  // - Preview mode
  // - Template selector
  // - Save/cancel buttons

  return (
    <div className="end-screen-editor">
      {/* Canvas Area */}
      <DragDropCanvas
        elements={elements}
        onElementMove={handleElementMove}
        onElementResize={handleElementResize}
        onElementSelect={setSelectedElement}
      />

      {/* Sidebar */}
      <div className="editor-sidebar">
        <ElementPicker onAdd={handleAddElement} />
        <TemplateSelector onSelect={handleApplyTemplate} />
        {selectedElement && (
          <ElementProperties
            element={elements.find(e => e.id === selectedElement)}
            onChange={handleElementChange}
            onDelete={handleDeleteElement}
          />
        )}
      </div>

      {/* Timeline */}
      <Timeline
        duration={videoDuration}
        elements={elements}
        currentTime={previewTime}
        onTimeChange={setPreviewTime}
        onElementTimingChange={handleTimingChange}
      />

      {/* Action Bar */}
      <div className="editor-actions">
        <button onClick={handlePreview}>Preview</button>
        <button onClick={handleSave} disabled={!isDirty}>Save</button>
        <button onClick={handleCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

### 2. Drag-Drop Canvas Component

```typescript
// apps/web/src/components/EndScreenEditor/DragDropCanvas.tsx

interface DragDropCanvasProps {
  elements: EndScreenElement[];
  onElementMove: (id: string, position: Position) => void;
  onElementResize: (id: string, size: Size) => void;
  onElementSelect: (id: string | null) => void;
}

export function DragDropCanvas({
  elements,
  onElementMove,
  onElementResize,
  onElementSelect
}: DragDropCanvasProps) {
  // Features:
  // - Grid overlay (optional, for snapping)
  // - Drag handles on selected element
  // - Resize handles on corners
  // - Visual feedback during drag
  // - Boundary constraints
  // - Z-index management

  return (
    <div className="canvas-container">
      <div className="canvas-aspect-ratio">
        <GridOverlay show={showGrid} />
        {elements.map(element => (
          <DraggableElement
            key={element.id}
            element={element}
            isSelected={selectedId === element.id}
            onMove={(pos) => onElementMove(element.id, pos)}
            onResize={(size) => onElementResize(element.id, size)}
            onSelect={() => onElementSelect(element.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 3. Timeline Component

```typescript
// apps/web/src/components/EndScreenEditor/Timeline.tsx

interface TimelineProps {
  duration: number;
  elements: EndScreenElement[];
  currentTime: number;
  onTimeChange: (time: number) => void;
  onElementTimingChange: (id: string, timing: Timing) => void;
}

export function Timeline({
  duration,
  elements,
  currentTime,
  onTimeChange,
  onElementTimingChange
}: TimelineProps) {
  // Shows last 20 seconds of video
  const timelineStart = Math.max(0, duration - 20);
  const timelineEnd = duration;

  return (
    <div className="timeline">
      <div className="timeline-ruler">
        {/* Time markers */}
      </div>

      <div className="timeline-tracks">
        {elements.map(element => (
          <TimelineTrack
            key={element.id}
            element={element}
            startTime={timelineStart}
            endTime={timelineEnd}
            onTimingChange={(timing) => onElementTimingChange(element.id, timing)}
          />
        ))}
      </div>

      <div className="timeline-playhead" style={{
        left: `${((currentTime - timelineStart) / 20) * 100}%`
      }} />
    </div>
  );
}
```

### 4. Element Picker Component

```typescript
// apps/web/src/components/EndScreenEditor/ElementPicker.tsx

interface ElementPickerProps {
  onAdd: (type: EndScreenElement['type']) => void;
}

export function ElementPicker({ onAdd }: ElementPickerProps) {
  const elementTypes = [
    { type: 'video', icon: VideoIcon, label: 'Video' },
    { type: 'playlist', icon: PlaylistIcon, label: 'Playlist' },
    { type: 'subscribe', icon: SubscribeIcon, label: 'Subscribe' },
    { type: 'channel', icon: ChannelIcon, label: 'Channel' },
    { type: 'link', icon: LinkIcon, label: 'Link' }
  ];

  return (
    <div className="element-picker">
      <h3>Add Element</h3>
      <div className="element-grid">
        {elementTypes.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            className="element-type-btn"
            onClick={() => onAdd(type)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

## Video Player Integration

### 1. End Screen Overlay Component

```typescript
// apps/web/src/components/VideoPlayer/EndScreenOverlay.tsx

interface EndScreenOverlayProps {
  config: EndScreenConfiguration;
  currentTime: number;
  videoDuration: number;
  onElementClick: (element: EndScreenElement) => void;
  lang: 'en' | 'ar';
}

export function EndScreenOverlay({
  config,
  currentTime,
  videoDuration,
  onElementClick,
  lang
}: EndScreenOverlayProps) {
  const timeFromEnd = videoDuration - currentTime;

  // Filter elements that should be visible at current time
  const visibleElements = config.elements.filter(element => {
    return timeFromEnd <= element.timing.startTime &&
           timeFromEnd >= element.timing.endTime;
  });

  return (
    <div className="end-screen-overlay">
      {visibleElements.map(element => (
        <EndScreenElement
          key={element.id}
          element={element}
          onElementClick={() => onElementClick(element)}
          lang={lang}
          timeFromEnd={timeFromEnd}
        />
      ))}
    </div>
  );
}
```

### 2. End Screen Element Renderer

```typescript
// apps/web/src/components/VideoPlayer/EndScreenElement.tsx

interface EndScreenElementProps {
  element: EndScreenElement;
  onElementClick: () => void;
  lang: 'en' | 'ar';
  timeFromEnd: number;
}

export function EndScreenElement({
  element,
  onElementClick,
  lang,
  timeFromEnd
}: EndScreenElementProps) {
  // Calculate opacity for fade animations
  const opacity = calculateOpacity(element.timing, timeFromEnd);

  // Position styles (percentage-based)
  const positionStyles = {
    position: 'absolute' as const,
    left: `${element.position.x}%`,
    top: `${element.position.y}%`,
    width: `${element.position.width}%`,
    height: `${element.position.height}%`,
    opacity,
    transition: `opacity ${element.timing.fadeIn || 300}ms ease-in-out`,
    ...element.style
  };

  // Render based on element type
  const renderContent = () => {
    switch (element.type) {
      case 'video':
        return <VideoElement data={element.data as VideoElementData} />;
      case 'playlist':
        return <PlaylistElement data={element.data as PlaylistElementData} />;
      case 'subscribe':
        return <SubscribeElement data={element.data as SubscribeElementData} />;
      case 'channel':
        return <ChannelElement data={element.data as ChannelElementData} />;
      case 'link':
        return <LinkElement data={element.data as LinkElementData} />;
      default:
        return null;
    }
  };

  return (
    <button
      className="end-screen-element"
      style={positionStyles}
      onClick={onElementClick}
      aria-label={getAriaLabel(element, lang)}
    >
      {renderContent()}
    </button>
  );
}
```

### 3. Integration with CustomVideoPlayer

```typescript
// Modify apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx

// Add to props
interface CustomVideoPlayerProps {
  // ... existing props ...
  endScreenConfig?: EndScreenConfiguration;
  onEndScreenClick?: (element: EndScreenElement) => void;
}

// Inside component
export default function CustomVideoPlayer({
  // ... existing props ...
  endScreenConfig,
  onEndScreenClick
}: CustomVideoPlayerProps) {
  // ... existing code ...

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Track current time for end screen display
  useEffect(() => {
    if (!playerRef.current) return;

    const player = playerRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(player.currentTime());
      setDuration(player.duration());
    };

    player.on('timeupdate', handleTimeUpdate);
    player.on('durationchange', handleTimeUpdate);

    return () => {
      player.off('timeupdate', handleTimeUpdate);
      player.off('durationchange', handleTimeUpdate);
    };
  }, [playerReady]);

  // Handle end screen element clicks
  const handleEndScreenClick = useCallback((element: EndScreenElement) => {
    // Track analytics
    analyticsRef.current?.trackEndScreenClick(element.id, element.type);

    // Call parent handler
    if (onEndScreenClick) {
      onEndScreenClick(element);
    }

    // Default navigation behavior
    switch (element.type) {
      case 'video':
        const videoData = element.data as VideoElementData;
        window.location.href = `/watch/${videoData.videoId}`;
        break;
      case 'playlist':
        const playlistData = element.data as PlaylistElementData;
        window.location.href = `/playlist/${playlistData.playlistId}`;
        break;
      case 'channel':
        const channelData = element.data as ChannelElementData;
        window.location.href = `/channel/${channelData.channelId}`;
        break;
      case 'subscribe':
        // Handle subscription (requires auth)
        handleSubscribe(element.data as SubscribeElementData);
        break;
      case 'link':
        const linkData = element.data as LinkElementData;
        if (linkData.approved) {
          window.open(linkData.url, '_blank');
        }
        break;
    }
  }, [onEndScreenClick]);

  return (
    <div className="custom-video-player">
      {/* ... existing video element ... */}

      {/* End Screen Overlay */}
      {endScreenConfig && endScreenConfig.isEnabled && duration > 0 && (
        <EndScreenOverlay
          config={endScreenConfig}
          currentTime={currentTime}
          videoDuration={duration}
          onElementClick={handleEndScreenClick}
          lang={lang}
        />
      )}

      {/* ... rest of player UI ... */}
    </div>
  );
}
```

---

## Templates System

### Pre-defined Templates

```typescript
// apps/web/src/lib/endScreenTemplates.ts

export const defaultTemplates: Omit<EndScreenTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '2x2 Grid',
    nameLocalized: {
      ar: 'شبكة 2×2'
    },
    category: 'grid',
    elements: [
      {
        id: 'tpl-1',
        type: 'video',
        position: { x: 20, y: 20, width: 25, height: 25 },
        timing: { startTime: 20, endTime: 0 }
      },
      {
        id: 'tpl-2',
        type: 'video',
        position: { x: 55, y: 20, width: 25, height: 25 },
        timing: { startTime: 20, endTime: 0 }
      },
      {
        id: 'tpl-3',
        type: 'subscribe',
        position: { x: 20, y: 55, width: 25, height: 25 },
        timing: { startTime: 20, endTime: 0 }
      },
      {
        id: 'tpl-4',
        type: 'playlist',
        position: { x: 55, y: 55, width: 25, height: 25 },
        timing: { startTime: 20, endTime: 0 }
      }
    ]
  },
  {
    name: 'Sidebar',
    nameLocalized: {
      ar: 'شريط جانبي'
    },
    category: 'sidebar',
    elements: [
      {
        id: 'tpl-1',
        type: 'video',
        position: { x: 70, y: 20, width: 25, height: 60 },
        timing: { startTime: 15, endTime: 0 }
      },
      {
        id: 'tpl-2',
        type: 'subscribe',
        position: { x: 5, y: 40, width: 20, height: 20 },
        timing: { startTime: 10, endTime: 0 }
      }
    ]
  },
  {
    name: 'Corner Subscribe',
    nameLocalized: {
      ar: 'اشتراك في الزاوية'
    },
    category: 'corner',
    elements: [
      {
        id: 'tpl-1',
        type: 'subscribe',
        position: { x: 75, y: 10, width: 20, height: 15 },
        timing: { startTime: 10, endTime: 0 }
      }
    ]
  }
];
```

### Template Selector Component

```typescript
// apps/web/src/components/EndScreenEditor/TemplateSelector.tsx

interface TemplateSelectorProps {
  onSelect: (template: EndScreenTemplate) => void;
  currentTemplateId?: string;
}

export function TemplateSelector({
  onSelect,
  currentTemplateId
}: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<EndScreenTemplate[]>([]);
  const [showCustom, setShowCustom] = useState(false);

  // Load templates
  useEffect(() => {
    loadTemplates();
  }, []);

  return (
    <div className="template-selector">
      <h3>Templates</h3>

      <div className="template-tabs">
        <button onClick={() => setShowCustom(false)}>Default</button>
        <button onClick={() => setShowCustom(true)}>My Templates</button>
      </div>

      <div className="template-grid">
        {templates.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            isSelected={template.id === currentTemplateId}
            onSelect={() => onSelect(template)}
          />
        ))}
      </div>

      <button className="save-as-template">
        Save Current as Template
      </button>
    </div>
  );
}
```

---

## Technical Implementation Details

### 1. Storage Structure

```
R2 Buckets:
├── end-screens/
│   ├── {videoId}.json              # End screen configuration per video
│   └── index/
│       └── by-channel/{channelId}  # Index for channel's videos
├── end-screen-templates/
│   ├── default/                    # System templates
│   │   ├── grid.json
│   │   ├── sidebar.json
│   │   └── corner.json
│   └── user/
│       └── {userId}/
│           └── {templateId}.json   # User custom templates
└── end-screen-analytics/
    └── {videoId}/
        └── {date}.json              # Daily analytics aggregation
```

### 2. Caching Strategy

```typescript
// Use Cloudflare KV for frequently accessed data
interface EndScreenCache {
  // Cache end screen configs for popular videos
  [`end-screen:${videoId}`]: EndScreenConfiguration;

  // Cache templates
  [`template:${templateId}`]: EndScreenTemplate;

  // Cache analytics (hourly aggregation)
  [`analytics:${videoId}:${hour}`]: {
    impressions: number;
    clicks: Record<string, number>; // elementId -> count
  };
}
```

### 3. Performance Optimizations

1. **Lazy Loading**: Load end screen config only when video reaches last 30 seconds
2. **Preloading**: Preload thumbnails and assets for end screen elements
3. **Batching**: Batch analytics events and send every 5 seconds
4. **CDN**: Store template thumbnails and element assets on CDN

### 4. Mobile Responsiveness

```typescript
// Responsive breakpoints for end screens
const breakpoints = {
  mobile: {
    maxElements: 2, // Limit to 2 elements on mobile
    minSize: { width: 30, height: 30 }, // Minimum 30% size
    spacing: 5 // 5% minimum spacing
  },
  tablet: {
    maxElements: 3,
    minSize: { width: 25, height: 25 },
    spacing: 3
  },
  desktop: {
    maxElements: 4,
    minSize: { width: 15, height: 15 },
    spacing: 2
  }
};
```

### 5. Accessibility Features

1. **Keyboard Navigation**: Tab through end screen elements
2. **Screen Reader Support**: Descriptive ARIA labels
3. **High Contrast Mode**: Visible borders in high contrast
4. **Focus Indicators**: Clear focus states
5. **Reduced Motion**: Respect prefers-reduced-motion

---

## Files to Create/Modify

### New Files to Create

```bash
# Shared Types
packages/shared-types/src/end-screen.ts

# API Endpoints
apps/api-videos/src/endpoints/video/endScreenGet.ts
apps/api-videos/src/endpoints/video/endScreenUpdate.ts
apps/api-videos/src/endpoints/video/endScreenDelete.ts
apps/api-videos/src/endpoints/video/endScreenAnalytics.ts
apps/api-videos/src/endpoints/template/templateList.ts
apps/api-videos/src/endpoints/template/templateCreate.ts
apps/api-videos/src/endpoints/template/templateUpdate.ts
apps/api-videos/src/endpoints/template/templateDelete.ts

# API Libraries
apps/api-videos/src/lib/endScreenValidator.ts
apps/api-videos/src/lib/endScreenRepository.ts

# Frontend Components
apps/web/src/components/EndScreenEditor/index.tsx
apps/web/src/components/EndScreenEditor/DragDropCanvas.tsx
apps/web/src/components/EndScreenEditor/Timeline.tsx
apps/web/src/components/EndScreenEditor/ElementPicker.tsx
apps/web/src/components/EndScreenEditor/ElementProperties.tsx
apps/web/src/components/EndScreenEditor/TemplateSelector.tsx
apps/web/src/components/EndScreenEditor/Preview.tsx
apps/web/src/components/VideoPlayer/EndScreenOverlay.tsx
apps/web/src/components/VideoPlayer/EndScreenElement.tsx

# Frontend Libraries
apps/web/src/lib/endScreenTemplates.ts
apps/web/src/lib/api/endScreens.ts
apps/web/src/hooks/useEndScreen.ts

# Styles
apps/web/src/styles/end-screen-editor.css
apps/web/src/styles/end-screen-overlay.css
```

### Files to Modify

```bash
# Update Types
packages/shared-types/src/video.ts          # Add endScreen field
packages/shared-types/src/index.ts          # Export end-screen types

# API Router
apps/api-videos/src/index.ts                # Register new endpoints

# Video Player
apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx  # Add overlay
apps/web/src/lib/video/videojs-setup.ts     # Player configuration

# Video Pages
apps/web/src/app/[locale]/watch/[id]/page.tsx  # Fetch end screen
apps/web/src/app/[locale]/studio/[videoId]/end-screen/page.tsx  # Editor page

# Analytics
apps/web/src/services/analytics/video-analytics.ts  # Track end screen events

# API Client
apps/web/src/lib/api/videos.ts              # Add end screen methods

# Wrangler Config
apps/api-videos/wrangler.jsonc              # Add R2 buckets for end screens
```

---

## Testing Strategy

### Unit Tests

```typescript
// apps/api-videos/src/endpoints/video/__tests__/endScreen.test.ts

describe('End Screen API', () => {
  test('should validate element positions', () => {
    // Elements must be within 0-100% bounds
  });

  test('should validate timing constraints', () => {
    // Start time must be 5-20 seconds from end
    // End time must be after start time
  });

  test('should limit number of elements', () => {
    // Maximum 5 elements per end screen
  });

  test('should validate element data based on type', () => {
    // Each element type has required fields
  });
});
```

### Integration Tests

```typescript
// apps/web/src/components/EndScreenEditor/__tests__/editor.test.tsx

describe('End Screen Editor', () => {
  test('should drag and drop elements', () => {
    // Simulate drag and drop interaction
  });

  test('should snap to grid', () => {
    // Verify grid snapping behavior
  });

  test('should apply templates', () => {
    // Select template and verify elements
  });

  test('should preview end screen', () => {
    // Toggle preview and verify rendering
  });
});
```

### E2E Tests

```typescript
// e2e/endScreens.spec.ts

test('Complete end screen workflow', async ({ page }) => {
  // 1. Navigate to video editor
  // 2. Open end screen editor
  // 3. Add elements
  // 4. Configure timing
  // 5. Save configuration
  // 6. Watch video and verify end screen appears
  // 7. Click element and verify navigation
});
```

### Performance Tests

1. **Load Time**: End screen config must load in < 100ms
2. **Render Time**: Elements must render in < 50ms
3. **Interaction**: Click response time < 100ms
4. **Memory**: No memory leaks during element animations

---

## Migration Plan

### Phase 1: Backend Infrastructure (Week 1)
- [ ] Create R2 buckets for end screens
- [ ] Implement data models and types
- [ ] Create CRUD endpoints for end screens
- [ ] Add validation and security checks

### Phase 2: Editor UI (Week 2)
- [ ] Build drag-and-drop canvas
- [ ] Implement timeline component
- [ ] Create element picker and properties panel
- [ ] Add template selector
- [ ] Implement preview mode

### Phase 3: Player Integration (Week 3)
- [ ] Create overlay renderer
- [ ] Add timing logic
- [ ] Implement click handlers
- [ ] Add analytics tracking
- [ ] Test on various devices

### Rollout Strategy

1. **Alpha Testing** (Internal team)
   - Deploy to staging environment
   - Test with 10 videos
   - Gather feedback

2. **Beta Testing** (Selected creators)
   - Enable for 100 creators
   - Monitor performance metrics
   - Collect user feedback

3. **General Release**
   - Gradual rollout to all users
   - Monitor analytics and performance
   - Iterate based on feedback

---

## Performance Considerations

### Metrics to Track

1. **Load Performance**
   - End screen config load time
   - Asset preloading time
   - Time to first render

2. **Runtime Performance**
   - Frame rate during animations
   - Click response time
   - Memory usage

3. **User Metrics**
   - Click-through rate (CTR)
   - Average view duration with end screens
   - Session time increase

### Optimization Strategies

1. **Code Splitting**: Load editor only when needed
2. **Asset Optimization**: Compress thumbnails, use WebP
3. **Caching**: Cache templates and popular configs
4. **Lazy Loading**: Load end screen assets at 50% video progress
5. **Animation Performance**: Use CSS transforms, avoid reflows

---

## Security & Validation

### Input Validation

```typescript
// apps/api-videos/src/lib/endScreenValidator.ts

import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(10).max(30),
  height: z.number().min(10).max(30)
});

const TimingSchema = z.object({
  startTime: z.number().min(5).max(20),
  endTime: z.number().min(0).max(15),
  fadeIn: z.number().min(0).max(1000).optional(),
  fadeOut: z.number().min(0).max(1000).optional()
});

const EndScreenElementSchema = z.object({
  id: z.string(),
  type: z.enum(['video', 'playlist', 'subscribe', 'channel', 'link']),
  position: PositionSchema,
  timing: TimingSchema,
  data: z.any() // Validated based on type
});

export const EndScreenConfigSchema = z.object({
  elements: z.array(EndScreenElementSchema).max(5),
  templateId: z.string().optional(),
  isEnabled: z.boolean()
});
```

### Security Considerations

1. **Authorization**: Only video owner can edit end screens
2. **External Links**: Require approval for external URLs
3. **Rate Limiting**: Limit end screen updates to prevent abuse
4. **Content Validation**: Verify referenced videos/playlists exist
5. **XSS Prevention**: Sanitize all user-provided text

---

## Implementation Checklist

### Week 1: Backend
- [ ] Create shared types for end screens
- [ ] Set up R2 buckets in wrangler config
- [ ] Implement CRUD endpoints
- [ ] Add validation middleware
- [ ] Create repository classes
- [ ] Write unit tests
- [ ] Deploy to staging

### Week 2: Editor
- [ ] Build drag-drop canvas component
- [ ] Implement timeline component
- [ ] Create element picker UI
- [ ] Add template selector
- [ ] Build preview mode
- [ ] Add save/cancel handlers
- [ ] Test editor functionality

### Week 3: Player Integration
- [ ] Create overlay component
- [ ] Implement timing logic
- [ ] Add element renderers
- [ ] Integrate with video player
- [ ] Add analytics tracking
- [ ] Test on mobile devices
- [ ] Performance optimization

### Post-Launch
- [ ] Monitor analytics
- [ ] Gather user feedback
- [ ] Fix bugs and issues
- [ ] Add more templates
- [ ] Optimize performance
- [ ] Consider A/B testing

---

## Success Metrics

### Technical Metrics
- End screen load time < 100ms
- Click response time < 100ms
- Zero runtime errors
- 99.9% availability

### Business Metrics
- 40% of creators use end screens
- 25% increase in session time
- 15% CTR on end screen elements
- 30% increase in subscriptions

### User Satisfaction
- 4+ star rating from creators
- Positive feedback on ease of use
- Reduced bounce rate
- Increased video-to-video navigation

---

## Future Enhancements

### Phase 2 Features
1. **Custom Graphics**: Upload custom images for elements
2. **Animation Effects**: More transition options
3. **A/B Testing**: Test different end screen configurations
4. **Smart Suggestions**: AI-powered element recommendations
5. **Branded Templates**: Channel-specific branded templates

### Phase 3 Features
1. **Interactive Elements**: Polls, quizzes in end screens
2. **Dynamic Content**: Personalized recommendations
3. **Cross-Platform**: End screens for live streams
4. **Advanced Analytics**: Heatmaps, user journey tracking
5. **Monetization**: Sponsored end screen elements

---

## Documentation Links

### Related Documents
- [YouTube Feature Comparison](../YOUTUBE_FEATURE_COMPARISON.md)
- [Video Upload Architecture](../../apps/api-videos/UPLOAD_ARCHITECTURE.md)
- [Frontend Architecture](../../apps/web/ARCHITECTURE.md)

### External References
- [YouTube End Screens Guide](https://support.google.com/youtube/answer/6388789)
- [Video.js Overlay Plugin](https://github.com/brightcove/videojs-overlay)
- [React DnD Library](https://react-dnd.github.io/react-dnd/)

---

## Conclusion

The End Screens feature is a critical component for increasing user engagement and session time on the Al Ummah Now platform. This implementation plan provides a comprehensive approach to building a YouTube-competitive end screen system while maintaining the platform's Islamic content focus and bilingual support.

The modular architecture ensures scalability, the drag-and-drop editor provides an intuitive user experience, and the template system enables quick adoption by creators. With proper implementation and testing, this feature should drive significant improvements in viewer retention and platform growth.

---

**Document Maintained By**: Architecture Team
**Last Updated**: 2025-01-20
**Next Review**: After Phase 1 Implementation