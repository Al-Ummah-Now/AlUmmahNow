# Shared Types Architecture

## Overview

The **shared-types** package is a centralized TypeScript type library that provides common type definitions for the entire Al Ummah Now platform. It ensures type consistency across all applications (web, api-videos, processor, websocket-server) and serves as the single source of truth for data structures and interfaces.

## Technology Stack

### Core Framework
- **TypeScript** - Type definitions and interfaces
- **pnpm Workspace** - Monorepo package management
- **Project References** - TypeScript project compilation
- **Semantic Versioning** - Version management

### Build System
- **TypeScript Compiler** - Type compilation and validation
- **Declaration Files** - .d.ts file generation
- **Package.json** - Dependency management
- **Workspace Protocol** - Internal package references

## Architecture Patterns

### 1. Type Organization Architecture
```
packages/shared-types/src/
├── video/                   # Video-related types
│   ├── index.ts            # Video type exports
│   ├── VideoObject.ts      # Core video type
│   ├── VideoMetadata.ts    # Video metadata
│   ├── VideoQuality.ts     # Quality definitions
│   └── VideoStatus.ts      # Status enums
├── channel/                 # Channel-related types
│   ├── index.ts            # Channel type exports
│   ├── ChannelObject.ts    # Core channel type
│   ├── ChannelSettings.ts  # Channel configuration
│   └── ChannelStats.ts     # Analytics types
├── user/                    # User-related types
│   ├── index.ts            # User type exports
│   ├── UserObject.ts       # Core user type
│   ├── UserProfile.ts      # Profile information
│   ├── UserPreferences.ts  # User settings
│   └── UserPermissions.ts  # Permission types
├── comment/                 # Comment system types
│   ├── index.ts            # Comment type exports
│   ├── CommentObject.ts    # Core comment type
│   ├── CommentThread.ts    # Thread structure
│   └── CommentModeration.ts # Moderation types
├── playlist/                # Playlist types
│   ├── index.ts            # Playlist type exports
│   ├── PlaylistObject.ts   # Core playlist type
│   ├── PlaylistItem.ts     # Item definitions
│   └── PlaylistSettings.ts # Configuration types
├── analytics/               # Analytics types
│   ├── index.ts            # Analytics type exports
│   ├── VideoAnalytics.ts   # Video metrics
│   ├── UserAnalytics.ts    # User behavior
│   ├── ChannelAnalytics.ts # Channel metrics
│   └── PlatformAnalytics.ts # Platform metrics
├── api/                     # API-related types
│   ├── index.ts            # API type exports
│   ├── ApiResponse.ts      # Response structures
│   ├── ApiError.ts         # Error definitions
│   ├── Pagination.ts       # Pagination types
│   └── Filters.ts          # Filter definitions
├── websocket/               # WebSocket types
│   ├── index.ts            # WebSocket type exports
│   ├── WebSocketMessage.ts # Message structures
│   ├── Subscription.ts     # Subscription types
│   └── Presence.ts         # Presence tracking
├── events/                  # Event system types
│   ├── index.ts            # Event type exports
│   ├── VideoEvent.ts       # Video events
│   ├── UserEvent.ts        # User events
│   ├── ChannelEvent.ts     # Channel events
│   └── SystemEvent.ts      # System events
├── common/                  # Common utility types
│   ├── index.ts            # Common type exports
│   ├── BaseTypes.ts        # Base interfaces
│   ├── Enums.ts            # Shared enums
│   ├── Constants.ts        # Type constants
│   └── Utilities.ts         # Type utilities
└── index.ts                 # Main export file
```

### 2. Type Definition Patterns
```typescript
// Core object pattern
interface VideoObject {
  id: string;
  title: string;
  description: string;
  channel: ChannelObject;
  metadata: VideoMetadata;
  createdAt: Date;
  updatedAt: Date;
}

// Metadata pattern
interface VideoMetadata {
  duration: number;
  quality: VideoQuality[];
  size: number;
  format: VideoFormat;
  thumbnail: string;
}

// Enum pattern
enum VideoStatus {
  PROCESSING = 'processing',
  PUBLISHED = 'published',
  PRIVATE = 'private',
  ARCHIVED = 'archived'
}

// API response pattern
interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  pagination?: PaginationInfo;
}
```

### 3. Export Strategy
```typescript
// Individual module exports
export * from './VideoObject';
export * from './VideoMetadata';
export * from './VideoStatus';

// Aggregated module exports
export * from './video';
export * from './channel';
export * from './user';

// Main package exports
export * from './video';
export * from './channel';
export * from './user';
export * from './comment';
export * from './playlist';
export * from './analytics';
export * from './api';
export * from './websocket';
export * from './events';
export * from './common';
```

## Key Architectural Components

### 1. Type System Design
- **Core Objects**: Primary domain entities
- **Metadata Types**: Supporting data structures
- **API Types**: Request/response interfaces
- **Event Types**: System event definitions

### 2. Type Safety Mechanisms
- **Strict Typing**: No implicit any types
- **Union Types**: Flexible type definitions
- **Generic Types**: Reusable type patterns
- **Type Guards**: Runtime type validation

### 3. Version Management
- **Semantic Versioning**: MAJOR.MINOR.PATCH
- **Breaking Changes**: Major version increments
- **Backward Compatibility**: Minor version updates
- **Patch Releases**: Bug fixes and additions

### 4. Documentation Integration
- **TSDoc Comments**: Comprehensive type documentation
- **Example Usage**: Code examples in comments
- **Type Relationships**: Clear dependency documentation
- **Migration Guides**: Version change documentation

## Type Categories Deep Dive

### 1. Domain Types
```typescript
// Video domain
interface VideoObject {
  id: string;
  title: string;
  description: string;
  channel: ChannelObject;
  metadata: VideoMetadata;
  stats: VideoStats;
  settings: VideoSettings;
}

// Channel domain
interface ChannelObject {
  id: string;
  name: string;
  description: string;
  owner: UserObject;
  settings: ChannelSettings;
  stats: ChannelStats;
}

// User domain
interface UserObject {
  id: string;
  username: string;
  email: string;
  profile: UserProfile;
  preferences: UserPreferences;
  permissions: UserPermissions;
}
```

### 2. API Types
```typescript
// Request/Response types
interface CreateVideoRequest {
  title: string;
  description: string;
  channelId: string;
  metadata: VideoMetadataInput;
}

interface VideoListResponse {
  videos: VideoObject[];
  pagination: PaginationInfo;
  filters: FilterInfo;
}

// Error types
interface ApiError {
  code: string;
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

// Pagination types
interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}
```

### 3. Event Types
```typescript
// Video events
interface VideoViewEvent {
  type: 'video:view';
  videoId: string;
  userId: string;
  timestamp: Date;
  metadata: ViewMetadata;
}

// User events
interface UserLoginEvent {
  type: 'user:login';
  userId: string;
  sessionId: string;
  timestamp: Date;
  context: LoginContext;
}

// System events
interface SystemMaintenanceEvent {
  type: 'system:maintenance';
  message: string;
  startTime: Date;
  endTime: Date;
  affectedServices: string[];
}
```

### 4. WebSocket Types
```typescript
// Message types
interface WebSocketMessage {
  type: MessageType;
  payload: any;
  timestamp: Date;
  messageId: string;
}

// Subscription types
interface Subscription {
  id: string;
  userId: string;
  channelType: ChannelType;
  channelId: string;
  filters: SubscriptionFilters;
}

// Presence types
interface PresenceUpdate {
  userId: string;
  status: PresenceStatus;
  lastSeen: Date;
  currentChannel?: string;
}
```

## Build and Distribution Architecture

### 1. TypeScript Configuration
```json
// tsconfig.json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 2. Package Configuration
```json
// package.json
{
  "name": "@al-ummah/shared-types",
  "version": "1.2.3",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./video": {
      "types": "./dist/video/index.d.ts",
      "import": "./dist/video/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
```

### 3. Workspace Integration
```json
// Root package.json workspace configuration
{
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build:shared-types": "pnpm --filter @al-ummah/shared-types build"
  }
}
```

## Type Safety and Validation

### 1. Runtime Validation
```typescript
// Zod integration for runtime validation
import { z } from 'zod';

const VideoSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  channel: ChannelSchema,
  metadata: VideoMetadataSchema,
});

type VideoObject = z.infer<typeof VideoSchema>;
```

### 2. Type Guards
```typescript
// Type guard functions
function isVideoObject(obj: any): obj is VideoObject {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.description === 'string' &&
    isChannelObject(obj.channel) &&
    isVideoMetadata(obj.metadata)
  );
}
```

### 3. Generic Types
```typescript
// Reusable generic patterns
interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: PaginationInfo;
}

interface Repository<T> {
  findById(id: string): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}
```

## Documentation Standards

### 1. TSDoc Documentation
```typescript
/**
 * Represents a video object in the Al Ummah Now platform
 * 
 * @example
 * ```typescript
 * const video: VideoObject = {
 *   id: 'video-123',
 *   title: 'Introduction to Islamic History',
 *   description: 'A comprehensive overview...',
 *   channel: channelObject,
 *   metadata: videoMetadata,
 *   createdAt: new Date(),
 *   updatedAt: new Date()
 * };
 * ```
 */
interface VideoObject {
  /** Unique identifier for the video */
  id: string;
  
  /** Video title (max 200 characters) */
  title: string;
  
  /** Video description (max 5000 characters) */
  description: string;
  
  /** Channel that owns this video */
  channel: ChannelObject;
  
  /** Video metadata and technical information */
  metadata: VideoMetadata;
  
  /** When the video was created */
  createdAt: Date;
  
  /** When the video was last updated */
  updatedAt: Date;
}
```

### 2. Type Relationship Documentation
```typescript
/**
 * Video metadata containing technical information
 * 
 * @see VideoObject - Parent object that uses this metadata
 * @see VideoQuality - Quality definitions used in metadata
 * @see VideoFormat - Format definitions used in metadata
 */
interface VideoMetadata {
  /** Video duration in seconds */
  duration: number;
  
  /** Available quality levels */
  quality: VideoQuality[];
  
  /** File size in bytes */
  size: number;
  
  /** Video format */
  format: VideoFormat;
  
  /** Thumbnail URL */
  thumbnail: string;
}
```

## Integration Patterns

### 1. Application Integration
```typescript
// In web application
import { VideoObject, ApiResponse } from '@al-ummah/shared-types';

interface VideoComponentProps {
  video: VideoObject;
  onUpdate: (video: VideoObject) => void;
}

// In API backend
import { VideoObject, CreateVideoRequest } from '@al-ummah/shared-types';

app.post('/videos', async (c: Context) => {
  const body: CreateVideoRequest = await c.req.json();
  const video: VideoObject = await createVideo(body);
  return c.json({ data: video, success: true });
});
```

### 2. Event System Integration
```typescript
// In processor
import { VideoViewEvent, UserEvent } from '@al-ummah/shared-types';

async function handleVideoViewEvent(event: VideoViewEvent) {
  await analyticsRepository.recordView(event);
  await presenceRepository.updateActivity(event.userId);
}

// In websocket server
import { WebSocketMessage, Subscription } from '@al-ummah/shared-types';

async function handleMessage(message: WebSocketMessage) {
  switch (message.type) {
    case 'subscribe':
      await handleSubscription(message.payload as Subscription);
      break;
    // ... other cases
  }
}
```

### 3. Database Integration
```typescript
// Repository pattern with shared types
import { VideoObject, CreateVideoRequest } from '@al-ummah/shared-types';

class VideoRepository {
  async findById(id: string): Promise<VideoObject | null> {
    const data = await this.r2.get(`videos/${id}.json`);
    return data ? JSON.parse(data) : null;
  }
  
  async create(request: CreateVideoRequest): Promise<VideoObject> {
    const video: VideoObject = {
      id: generateId(),
      ...request,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await this.r2.put(`videos/${video.id}.json`, JSON.stringify(video));
    return video;
  }
}
```

## Version Management Strategy

### 1. Semantic Versioning
- **MAJOR**: Breaking changes to existing types
- **MINOR**: New types or optional properties
- **PATCH**: Bug fixes or documentation updates

### 2. Breaking Change Management
```typescript
// Version 1.x.x
interface VideoObject {
  id: string;
  title: string;
  description: string;
}

// Version 2.0.0 (breaking change)
interface VideoObject {
  id: string;
  title: string;
  description: string;
  metadata: VideoMetadata; // New required field
}

// Migration guide
/**
 * @deprecated Use VideoObjectV2 instead
 * @migration Add metadata field to existing video objects
 */
interface VideoObjectV1 {
  id: string;
  title: string;
  description: string;
}
```

### 3. Backward Compatibility
```typescript
// Adding optional fields (minor version)
interface VideoObject {
  id: string;
  title: string;
  description: string;
  metadata?: VideoMetadata; // Optional field
}

// Union types for compatibility
type VideoObjectLegacy = VideoObjectV1 | VideoObjectV2;
```

## Testing Strategy

### 1. Type Testing
```typescript
// Type compilation tests
import { VideoObject } from '@al-ummah/shared-types';

// This should compile without errors
const video: VideoObject = {
  id: 'test',
  title: 'Test Video',
  description: 'Test Description',
  channel: mockChannel,
  metadata: mockMetadata,
  createdAt: new Date(),
  updatedAt: new Date()
};

// This should fail compilation
const invalidVideo: VideoObject = {
  // Missing required fields - should cause TypeScript error
};
```

### 2. Runtime Validation Tests
```typescript
// Zod schema validation tests
import { VideoSchema } from '@al-ummah/shared-types';

test('valid video object passes validation', () => {
  const validVideo = { /* valid video data */ };
  expect(VideoSchema.parse(validVideo)).toBeDefined();
});

test('invalid video object fails validation', () => {
  const invalidVideo = { /* invalid video data */ };
  expect(() => VideoSchema.parse(invalidVideo)).toThrow();
});
```

## Key Architectural Decisions

### 1. Centralized Type Management
**Decision**: Create a dedicated shared types package.

**Rationale**:
- Single source of truth for type definitions
- Consistent typing across all applications
- Reduced duplication and maintenance overhead
- Improved developer experience with IntelliSense

### 2. Modular Type Organization
**Decision**: Organize types by domain and feature.

**Rationale**:
- Clear separation of concerns
- Easy navigation and discovery
- Targeted imports for better tree-shaking
- Scalable organization for growth

### 3. Strict Type Safety
**Decision**: Enforce strict TypeScript configuration.

**Rationale**:
- Catch errors at compile time
- Improved code quality and reliability
- Better IDE support and autocomplete
- Reduced runtime errors

### 4. Comprehensive Documentation
**Decision**: Use TSDoc for comprehensive type documentation.

**Rationale**:
- Self-documenting code
- Better developer experience
- Automatic API documentation generation
- Clear usage examples and guidelines

## Future Architecture Considerations

### 1. Type System Enhancements
- **Advanced Generics**: More sophisticated generic patterns
- **Conditional Types**: Dynamic type selection
- **Template Literal Types**: String manipulation types
- **Recursive Types**: Self-referencing type definitions

### 2. Tooling Improvements
- **Automated Generation**: Type generation from API schemas
- **Validation Integration**: Runtime validation integration
- **Documentation Generation**: Automated documentation sites
- **Migration Tools**: Automated type migration tools

### 3. Ecosystem Integration
- **OpenAPI Integration**: Type generation from OpenAPI specs
- **Database Integration**: Type generation from database schemas
- **Frontend Integration**: Component prop type generation
- **Testing Integration**: Test type generation

## Conclusion

The Shared Types architecture provides a robust, scalable, and maintainable foundation for type management across the Al Ummah Now platform. The centralized approach ensures consistency, reduces duplication, and improves developer experience while maintaining strict type safety and comprehensive documentation.

The architecture prioritizes developer productivity through clear type organization, comprehensive documentation, and seamless integration across all platform components. The modular design allows for scalable growth while maintaining backward compatibility and providing clear migration paths for future enhancements.