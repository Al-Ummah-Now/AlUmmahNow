# Feature 19: Processing Priority & Quality Selection Implementation Plan

## Executive Summary

This document outlines the implementation plan for Processing Priority and Quality Selection feature, which allows control over video encoding resolutions and processing priority for different user tiers. While Bunny.net handles the actual encoding automatically, this feature focuses on configuring encoding settings, providing UI controls, and implementing priority tiers through their available API.

## 1. Bunny.net API Capabilities Review

### 1.1 Current Capabilities

Based on Bunny.net Stream API analysis:

#### Resolution Control
- **Pre-upload Configuration**: Resolutions must be configured BEFORE video upload
- **Available Resolutions**: 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p (4K)
- **Bitrate Customization**: Each resolution has customizable bitrate settings
- **API Parameter**: `enabledResolutions` parameter during upload

#### Encoding Features
- **Automatic Transcoding**: Free automatic conversion to multiple resolutions
- **Early-Play**: Allows playback before all resolutions finish encoding
- **MP4 Fallback**: Can generate MP4 files up to 720p for compatibility
- **Keep Original**: Option to preserve source video for re-encoding
- **Watermarking**: Apply watermarks during encoding
- **Content Tagging**: Automatic content categorization

#### Premium Encoding (Priority Processing)
- **Premium Queue**: Dedicated encoding queue with minimal wait times
- **Just-In-Time Encoding**: Videos ready seconds after upload
- **Pricing**: $0.05 per input minute of processed video
- **VP9 Codec Support**: 30% bandwidth/storage savings
- **2x Faster Processing**: Doubled transcoding capacity (as of late 2024)

### 1.2 API Endpoints

```typescript
// Create video with encoding settings
POST /library/{libraryId}/videos
{
  "title": "string",
  "collectionId": "string",
  "thumbnailTime": 0
}

// Upload with resolution control
PUT /library/{libraryId}/videos/{videoId}?enabledResolutions=240p,360p,720p,1080p
Body: video file

// Re-encode existing video
POST /library/{libraryId}/videos/{videoId}/reencode

// Clean up unconfigured resolutions
DELETE /library/{libraryId}/videos/{videoId}/resolutions
```

### 1.3 Limitations

- Cannot change resolutions AFTER upload (requires re-encoding)
- No granular control over encoding order (e.g., prioritize 720p first)
- Premium encoding is library-wide, not per-video
- No API to check encoding progress by resolution

## 2. Priority Processing Options

### 2.1 User Tiers

```typescript
enum UserTier {
  FREE = 'free',
  CREATOR = 'creator',
  PARTNER = 'partner',
  ENTERPRISE = 'enterprise'
}

interface TierConfig {
  tier: UserTier;
  maxResolution: string;
  enabledResolutions: string[];
  premiumEncoding: boolean;
  maxFileSize: number; // in MB
  processingPriority: number; // 1-10, higher = faster
  features: {
    earlyPlay: boolean;
    mp4Fallback: boolean;
    keepOriginal: boolean;
    watermark: boolean;
    contentTagging: boolean;
  };
}
```

### 2.2 Tier Configurations

```typescript
const TIER_CONFIGS: Record<UserTier, TierConfig> = {
  [UserTier.FREE]: {
    tier: UserTier.FREE,
    maxResolution: '720p',
    enabledResolutions: ['240p', '360p', '480p', '720p'],
    premiumEncoding: false,
    maxFileSize: 100, // 100MB
    processingPriority: 1,
    features: {
      earlyPlay: false,
      mp4Fallback: true,
      keepOriginal: false,
      watermark: true, // Platform watermark
      contentTagging: false
    }
  },
  [UserTier.CREATOR]: {
    tier: UserTier.CREATOR,
    maxResolution: '1080p',
    enabledResolutions: ['240p', '360p', '480p', '720p', '1080p'],
    premiumEncoding: false,
    maxFileSize: 500, // 500MB
    processingPriority: 5,
    features: {
      earlyPlay: true,
      mp4Fallback: true,
      keepOriginal: true,
      watermark: false,
      contentTagging: true
    }
  },
  [UserTier.PARTNER]: {
    tier: UserTier.PARTNER,
    maxResolution: '2160p',
    enabledResolutions: ['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'],
    premiumEncoding: true, // Priority processing
    maxFileSize: 2000, // 2GB
    processingPriority: 8,
    features: {
      earlyPlay: true,
      mp4Fallback: true,
      keepOriginal: true,
      watermark: false,
      contentTagging: true
    }
  },
  [UserTier.ENTERPRISE]: {
    tier: UserTier.ENTERPRISE,
    maxResolution: '2160p',
    enabledResolutions: ['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'],
    premiumEncoding: true,
    maxFileSize: 10000, // 10GB
    processingPriority: 10,
    features: {
      earlyPlay: true,
      mp4Fallback: true,
      keepOriginal: true,
      watermark: false, // Optional custom watermark
      contentTagging: true
    }
  }
};
```

### 2.3 Implementation Strategy

Since Bunny.net doesn't support per-video priority, we'll implement:

1. **Multiple Video Libraries**: Create separate Bunny.net libraries for each tier
   - `al-ummah-free`: Standard encoding
   - `al-ummah-creator`: Standard encoding with more resolutions
   - `al-ummah-partner`: Premium encoding enabled
   - `al-ummah-enterprise`: Premium encoding with all features

2. **Smart Routing**: Route uploads to appropriate library based on user tier

3. **Quota Management**: Track encoding minutes used per user/tier

## 3. Resolution Selection UI

### 3.1 Upload Interface

```typescript
// Component: VideoUploadSettings.tsx
interface VideoUploadSettingsProps {
  userTier: UserTier;
  onSettingsChange: (settings: UploadSettings) => void;
}

interface UploadSettings {
  title: string;
  description: string;
  privacy: 'public' | 'private' | 'unlisted';
  selectedResolutions: string[];
  advancedSettings: {
    earlyPlay: boolean;
    mp4Fallback: boolean;
    keepOriginal: boolean;
  };
}
```

### 3.2 UI Components

#### Resolution Selector
```tsx
// ResolutionSelector.tsx
const ResolutionSelector: React.FC<{
  availableResolutions: string[];
  selectedResolutions: string[];
  onChange: (resolutions: string[]) => void;
  userTier: UserTier;
}> = ({ availableResolutions, selectedResolutions, onChange, userTier }) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Video Quality Settings</h3>

      {/* Quick presets */}
      <div className="flex gap-2">
        <button onClick={() => onChange(['360p', '720p'])}>
          Basic (360p, 720p)
        </button>
        <button onClick={() => onChange(['360p', '720p', '1080p'])}>
          Standard (up to 1080p)
        </button>
        {userTier !== UserTier.FREE && (
          <button onClick={() => onChange(availableResolutions)}>
            Maximum Quality (All)
          </button>
        )}
      </div>

      {/* Individual resolution toggles */}
      <div className="grid grid-cols-3 gap-3">
        {availableResolutions.map(resolution => (
          <label key={resolution} className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={selectedResolutions.includes(resolution)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selectedResolutions, resolution]);
                } else {
                  onChange(selectedResolutions.filter(r => r !== resolution));
                }
              }}
            />
            <span>{resolution}</span>
            {getEstimatedSize(resolution)}
          </label>
        ))}
      </div>

      {/* Storage estimate */}
      <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded">
        <p className="text-sm">
          Estimated storage: {calculateStorageEstimate(selectedResolutions)}
        </p>
        {userTier === UserTier.PARTNER && (
          <p className="text-sm text-green-600">
            ✓ Priority encoding enabled - Video ready in seconds
          </p>
        )}
      </div>
    </div>
  );
};
```

#### Processing Status
```tsx
// VideoProcessingStatus.tsx
interface ProcessingStatus {
  videoId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    overall: number;
    resolutions: {
      [resolution: string]: {
        status: 'pending' | 'processing' | 'completed' | 'failed';
        progress: number;
      };
    };
  };
  estimatedTime: number; // seconds
  isPriority: boolean;
}

const VideoProcessingStatus: React.FC<{ status: ProcessingStatus }> = ({ status }) => {
  return (
    <div className="space-y-4">
      {status.isPriority && (
        <div className="bg-purple-100 text-purple-800 px-3 py-2 rounded">
          ⚡ Priority Processing Active
        </div>
      )}

      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Overall Progress</span>
          <span>{status.progress.overall}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full"
            style={{ width: `${status.progress.overall}%` }}
          />
        </div>
      </div>

      {/* Resolution breakdown */}
      <div className="space-y-1">
        {Object.entries(status.progress.resolutions).map(([res, data]) => (
          <div key={res} className="flex items-center justify-between text-sm">
            <span>{res}</span>
            <span className={`
              ${data.status === 'completed' ? 'text-green-600' : ''}
              ${data.status === 'processing' ? 'text-blue-600' : ''}
              ${data.status === 'failed' ? 'text-red-600' : ''}
            `}>
              {data.status === 'completed' ? '✓' :
               data.status === 'processing' ? `${data.progress}%` :
               data.status === 'failed' ? '✗' : '•'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 3.3 Channel Settings Page

```tsx
// ChannelEncodingSettings.tsx
const ChannelEncodingSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Default Encoding Settings</h2>

      {/* Current tier display */}
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-4 rounded-lg">
        <h3 className="text-lg font-semibold">Your Plan: Partner</h3>
        <p>Premium encoding enabled • Up to 4K resolution • Priority processing</p>
      </div>

      {/* Default settings */}
      <div className="space-y-4">
        <ResolutionSelector
          availableResolutions={tierConfig.enabledResolutions}
          selectedResolutions={defaultResolutions}
          onChange={updateDefaultResolutions}
          userTier={UserTier.PARTNER}
        />

        {/* Advanced options */}
        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3">Advanced Options</h3>
          <div className="space-y-2">
            <label className="flex items-center justify-between">
              <span>Enable Early Play (start watching while encoding)</span>
              <input type="checkbox" />
            </label>
            <label className="flex items-center justify-between">
              <span>Generate MP4 fallback (for compatibility)</span>
              <input type="checkbox" />
            </label>
            <label className="flex items-center justify-between">
              <span>Keep original file (for re-encoding)</span>
              <input type="checkbox" />
            </label>
          </div>
        </div>
      </div>

      {/* Usage statistics */}
      <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
        <h3 className="font-semibold mb-2">This Month's Usage</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Videos Processed:</span>
            <span className="ml-2 font-semibold">47</span>
          </div>
          <div>
            <span className="text-gray-600">Premium Minutes:</span>
            <span className="ml-2 font-semibold">234 / 1000</span>
          </div>
          <div>
            <span className="text-gray-600">Storage Used:</span>
            <span className="ml-2 font-semibold">45.2 GB</span>
          </div>
          <div>
            <span className="text-gray-600">Avg Processing Time:</span>
            <span className="ml-2 font-semibold text-green-600">2.3 min</span>
          </div>
        </div>
      </div>
    </div>
  );
};
```

## 4. Technical Implementation Details

### 4.1 Database Schema Updates

```typescript
// User tier tracking
interface UserProfile {
  // ... existing fields
  tier: UserTier;
  tierExpiry?: string; // ISO date for subscription expiry
  encodingQuota: {
    premiumMinutesUsed: number;
    premiumMinutesLimit: number;
    standardVideosProcessed: number;
    resetDate: string; // Monthly reset
  };
}

// Video encoding metadata
interface Video {
  // ... existing fields
  encodingSettings: {
    requestedResolutions: string[];
    completedResolutions: string[];
    libraryId: number; // Which Bunny library was used
    isPremium: boolean;
    encodingStarted: string;
    encodingCompleted?: string;
    encodingDuration?: number; // seconds
  };
  processingStatus: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
  processingError?: string;
}

// Channel default settings
interface Channel {
  // ... existing fields
  defaultEncodingSettings: {
    resolutions: string[];
    earlyPlay: boolean;
    mp4Fallback: boolean;
    keepOriginal: boolean;
  };
}
```

### 4.2 API Endpoint Updates

#### 4.2.1 Get Encoding Settings
```typescript
// GET /api/encoding/settings
export class GetEncodingSettings extends OpenAPIRoute {
  schema = {
    tags: ["Encoding"],
    summary: "Get user's encoding settings and tier info",
    responses: {
      200: {
        description: "Encoding settings",
        content: {
          "application/json": {
            schema: z.object({
              tier: z.enum(['free', 'creator', 'partner', 'enterprise']),
              tierConfig: TierConfigSchema,
              quota: z.object({
                premiumMinutesUsed: z.number(),
                premiumMinutesLimit: z.number(),
                resetDate: z.string()
              }),
              defaultSettings: z.object({
                resolutions: z.array(z.string()),
                earlyPlay: z.boolean(),
                mp4Fallback: z.boolean(),
                keepOriginal: z.boolean()
              })
            })
          }
        }
      }
    }
  };

  async handle(c) {
    const userId = c.get('userId');
    const profile = await getUserProfile(userId);
    const tierConfig = TIER_CONFIGS[profile.tier];

    return c.json({
      tier: profile.tier,
      tierConfig,
      quota: profile.encodingQuota,
      defaultSettings: await getChannelDefaultSettings(userId)
    });
  }
}
```

#### 4.2.2 Update Default Settings
```typescript
// PUT /api/encoding/settings
export class UpdateEncodingSettings extends OpenAPIRoute {
  schema = {
    tags: ["Encoding"],
    summary: "Update default encoding settings",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              resolutions: z.array(z.string()).optional(),
              earlyPlay: z.boolean().optional(),
              mp4Fallback: z.boolean().optional(),
              keepOriginal: z.boolean().optional()
            })
          }
        }
      }
    }
  };

  async handle(c) {
    const userId = c.get('userId');
    const body = await c.req.json();

    // Validate resolutions against user tier
    const profile = await getUserProfile(userId);
    const tierConfig = TIER_CONFIGS[profile.tier];

    if (body.resolutions) {
      const invalidResolutions = body.resolutions.filter(
        r => !tierConfig.enabledResolutions.includes(r)
      );
      if (invalidResolutions.length > 0) {
        return c.json({
          error: `Invalid resolutions for your tier: ${invalidResolutions.join(', ')}`
        }, 400);
      }
    }

    await updateChannelSettings(userId, body);
    return c.json({ success: true });
  }
}
```

#### 4.2.3 Enhanced Video Upload
```typescript
// Modify existing VideoUpload endpoint
export class VideoUpload extends OpenAPIRoute {
  async handle(c) {
    const userId = c.get('userId');
    const formData = await c.req.formData();

    // Get user tier and settings
    const profile = await getUserProfile(userId);
    const tierConfig = TIER_CONFIGS[profile.tier];

    // Parse requested resolutions or use defaults
    const requestedResolutions = formData.get('resolutions')?.split(',') ||
                                 tierConfig.enabledResolutions;

    // Validate against tier limits
    const allowedResolutions = requestedResolutions.filter(
      r => tierConfig.enabledResolutions.includes(r)
    );

    // Determine which Bunny library to use
    const libraryId = getLibraryForTier(profile.tier);

    // Check quota for premium encoding
    if (tierConfig.premiumEncoding) {
      const videoLength = await estimateVideoLength(file); // minutes
      if (profile.encodingQuota.premiumMinutesUsed + videoLength >
          profile.encodingQuota.premiumMinutesLimit) {
        return c.json({
          error: 'Premium encoding quota exceeded. Video will use standard processing.'
        }, 402);
      }
    }

    // Upload to Bunny with resolution settings
    const bunnyStream = new BunnyStreamClient(bunnyKey);
    const bunnyVideo = await bunnyStream.createVideo(libraryId, {
      title,
      thumbnailTime: 0,
    });

    // Upload with enabled resolutions
    const uploadResult = await bunnyStream.uploadVideo(
      libraryId,
      videoId,
      fileBlob,
      allowedResolutions.join(',')
    );

    // Save encoding metadata
    await saveVideo({
      ...videoData,
      encodingSettings: {
        requestedResolutions: allowedResolutions,
        completedResolutions: [],
        libraryId,
        isPremium: tierConfig.premiumEncoding,
        encodingStarted: new Date().toISOString()
      },
      processingStatus: 'queued'
    });

    // Track quota usage
    if (tierConfig.premiumEncoding) {
      await incrementPremiumQuota(userId, videoLength);
    }

    return c.json({
      success: true,
      videoId,
      processingInfo: {
        tier: profile.tier,
        isPriority: tierConfig.premiumEncoding,
        resolutions: allowedResolutions,
        estimatedTime: tierConfig.premiumEncoding ? '1-2 minutes' : '5-15 minutes'
      }
    });
  }
}
```

#### 4.2.4 Processing Status Endpoint
```typescript
// GET /api/videos/{id}/processing-status
export class GetProcessingStatus extends OpenAPIRoute {
  schema = {
    tags: ["Videos"],
    summary: "Get video processing status",
    request: {
      params: z.object({
        id: z.string()
      })
    }
  };

  async handle(c) {
    const videoId = c.req.param('id');
    const video = await getVideo(videoId);

    if (!video) {
      return c.json({ error: 'Video not found' }, 404);
    }

    // Get status from Bunny Stream
    const bunnyStream = new BunnyStreamClient(bunnyKey);
    const bunnyVideo = await bunnyStream.getVideo(
      video.encodingSettings.libraryId,
      videoId
    );

    // Calculate progress based on available resolutions
    const completedResolutions = bunnyVideo.availableResolutions || [];
    const progress = (completedResolutions.length /
                     video.encodingSettings.requestedResolutions.length) * 100;

    return c.json({
      videoId,
      status: bunnyVideo.status === 4 ? 'completed' :
              bunnyVideo.status === 3 ? 'processing' :
              bunnyVideo.status === 2 ? 'queued' : 'failed',
      progress: {
        overall: Math.round(progress),
        resolutions: video.encodingSettings.requestedResolutions.reduce((acc, res) => {
          acc[res] = {
            status: completedResolutions.includes(res) ? 'completed' : 'pending',
            progress: completedResolutions.includes(res) ? 100 : 0
          };
          return acc;
        }, {})
      },
      isPriority: video.encodingSettings.isPremium,
      completedResolutions,
      thumbnailUrl: bunnyVideo.thumbnailUrl
    });
  }
}
```

### 4.3 Bunny Stream Client Updates

```typescript
// Add to BunnyStreamClient class
class BunnyStreamClient {
  // ... existing methods

  // Re-encode video with different settings
  async reencodeVideo(
    libraryId: number,
    videoId: string,
    enabledResolutions?: string
  ): Promise<void> {
    const params = enabledResolutions ? { enabledResolutions } : {};
    return this.request('POST', `/library/${libraryId}/videos/${videoId}/reencode`, undefined, params);
  }

  // Get video encoding progress
  async getEncodingProgress(libraryId: number, videoId: string): Promise<any> {
    const video = await this.getVideo(libraryId, videoId);
    return {
      status: video.status,
      availableResolutions: video.availableResolutions || [],
      encodingProgress: video.encodeProgress || 0,
      processingStarted: video.dateUploaded,
      thumbnailStatus: video.thumbnailStatus
    };
  }

  // Delete specific resolutions
  async deleteResolutions(
    libraryId: number,
    videoId: string,
    resolutions: string[]
  ): Promise<void> {
    return this.request('DELETE', `/library/${libraryId}/videos/${videoId}/resolutions`, {
      resolutions
    });
  }

  // Update video library settings
  async updateLibrarySettings(
    libraryId: number,
    settings: {
      enabledResolutions?: string[];
      watermarkUrl?: string;
      keepOriginalFiles?: boolean;
      enableMp4Fallback?: boolean;
    }
  ): Promise<void> {
    return this.request('POST', `/library/${libraryId}/settings`, settings);
  }
}
```

### 4.4 WebSocket Notifications

```typescript
// Add to WebSocket server for real-time updates
interface EncodingProgressMessage {
  type: 'encoding_progress';
  videoId: string;
  progress: number;
  resolution?: string;
  status: 'started' | 'progress' | 'completed' | 'failed';
}

// Webhook handler for Bunny Stream
export class BunnyWebhook extends OpenAPIRoute {
  async handle(c) {
    const event = await c.req.json();

    if (event.Type === 'video_encoded') {
      const { VideoGuid, Status, AvailableResolutions } = event;

      // Update video status in R2
      await updateVideoEncodingStatus(VideoGuid, {
        completedResolutions: AvailableResolutions,
        processingStatus: 'completed',
        encodingCompleted: new Date().toISOString()
      });

      // Notify via WebSocket
      await broadcastToUser(userId, {
        type: 'encoding_progress',
        videoId: VideoGuid,
        progress: 100,
        status: 'completed'
      });
    }

    return c.json({ received: true });
  }
}
```

## 5. Files to Create/Modify

### 5.1 New Files to Create

```
apps/api-videos/src/
├── endpoints/
│   └── encoding/
│       ├── getSettings.ts           # GET /api/encoding/settings
│       ├── updateSettings.ts        # PUT /api/encoding/settings
│       ├── getProcessingStatus.ts   # GET /api/videos/{id}/processing-status
│       └── reencodeVideo.ts         # POST /api/videos/{id}/reencode
├── lib/
│   ├── tiers/
│   │   ├── config.ts               # Tier configurations
│   │   ├── quotaManager.ts         # Quota tracking
│   │   └── libraryRouter.ts        # Route to correct Bunny library
│   └── bunny/
│       └── webhookHandler.ts       # Bunny Stream webhook processor

apps/web/src/
├── components/
│   ├── Upload/
│   │   ├── ResolutionSelector.tsx
│   │   ├── VideoUploadSettings.tsx
│   │   └── ProcessingStatus.tsx
│   └── Channel/
│       └── EncodingSettings.tsx
├── hooks/
│   └── useEncodingSettings.ts
└── lib/
    └── api/
        └── encoding.ts              # Client API for encoding endpoints
```

### 5.2 Files to Modify

```
apps/api-videos/src/
├── index.ts                         # Register new endpoints
├── endpoints/video/
│   ├── videoUpload.ts              # Add resolution control
│   └── uploadComplete.ts           # Update with encoding settings
├── lib/
│   ├── bunny/stream.ts             # Add new methods
│   └── types.ts                    # Add encoding types

apps/web/src/
├── app/[locale]/upload/page.tsx    # Integrate resolution selector
├── app/[locale]/channel/[id]/settings/page.tsx  # Add encoding tab
└── components/Video/VideoCard.tsx  # Show processing status
```

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
// Test tier configuration logic
describe('TierConfiguration', () => {
  test('should return correct resolutions for FREE tier', () => {
    const config = getTierConfig(UserTier.FREE);
    expect(config.enabledResolutions).toEqual(['240p', '360p', '480p', '720p']);
    expect(config.premiumEncoding).toBe(false);
  });

  test('should validate resolution against tier', () => {
    const isValid = validateResolution('4K', UserTier.FREE);
    expect(isValid).toBe(false);
  });
});

// Test quota management
describe('QuotaManager', () => {
  test('should track premium minutes correctly', async () => {
    await incrementPremiumQuota('user123', 10);
    const quota = await getUserQuota('user123');
    expect(quota.premiumMinutesUsed).toBe(10);
  });

  test('should reset quota monthly', async () => {
    const quota = await getUserQuota('user123');
    const shouldReset = isQuotaResetDue(quota.resetDate);
    expect(shouldReset).toBeDefined();
  });
});
```

### 6.2 Integration Tests

```typescript
// Test upload with different tiers
describe('VideoUpload', () => {
  test('FREE tier should limit to 720p', async () => {
    const response = await uploadVideo({
      file: testVideo,
      resolutions: ['720p', '1080p', '4K'],
      userTier: UserTier.FREE
    });

    expect(response.processingInfo.resolutions).not.toContain('1080p');
    expect(response.processingInfo.resolutions).not.toContain('4K');
  });

  test('PARTNER tier should use premium encoding', async () => {
    const response = await uploadVideo({
      file: testVideo,
      userTier: UserTier.PARTNER
    });

    expect(response.processingInfo.isPriority).toBe(true);
  });
});
```

### 6.3 E2E Tests

```typescript
// Test complete upload and processing flow
describe('E2E Video Processing', () => {
  test('should upload, process, and notify completion', async () => {
    // 1. Upload video
    const upload = await uploadVideo(testVideo);

    // 2. Check initial status
    let status = await getProcessingStatus(upload.videoId);
    expect(status.status).toBeOneOf(['queued', 'processing']);

    // 3. Wait for webhook (mocked)
    await simulateBunnyWebhook({
      Type: 'video_encoded',
      VideoGuid: upload.videoId,
      AvailableResolutions: ['360p', '720p', '1080p']
    });

    // 4. Verify completion
    status = await getProcessingStatus(upload.videoId);
    expect(status.status).toBe('completed');
    expect(status.completedResolutions).toContain('1080p');
  });
});
```

### 6.4 Manual Testing Checklist

- [ ] Upload video as FREE user - verify 720p limit
- [ ] Upload video as PARTNER - verify priority processing
- [ ] Change default encoding settings
- [ ] Verify resolution selector shows correct options per tier
- [ ] Test quota enforcement (exceed premium minutes)
- [ ] Verify processing status updates in real-time
- [ ] Test re-encoding existing video
- [ ] Verify webhook notifications work
- [ ] Test fallback to standard encoding when premium fails
- [ ] Check storage estimates are accurate

## 7. Cost Implications

### 7.1 Bunny.net Costs

#### Storage Costs
- **Standard Storage**: $0.005 - $0.020 per GB/month (varies by region)
- **Multiple Resolutions Impact**: Each resolution increases storage by ~40-60%
  - 1 hour of 1080p video ≈ 1.5 GB
  - With 5 resolutions (240p-1080p) ≈ 3-4 GB total
  - With 7 resolutions (240p-4K) ≈ 8-10 GB total

#### Premium Encoding Costs
- **Rate**: $0.05 per input minute
- **Example Monthly Costs**:
  - 100 videos × 10 min = 1,000 min × $0.05 = $50
  - 1,000 videos × 10 min = 10,000 min × $0.05 = $500

#### Bandwidth Costs
- **CDN Delivery**: $0.005 - $0.030 per GB (varies by region)
- **VP9 Codec**: 30% bandwidth savings for premium tier

### 7.2 Cost Optimization Strategies

1. **Tier-based Resolution Limits**
   - FREE: Max 720p saves ~60% storage vs 4K
   - CREATOR: Max 1080p saves ~40% storage vs 4K

2. **Smart Defaults**
   - Default to minimal resolutions (360p, 720p)
   - Let users opt-in to higher resolutions

3. **Cleanup Policies**
   - Auto-delete unused resolutions after 30 days
   - Remove original files after successful encoding (except Enterprise)

4. **Quota System**
   - Limit premium minutes per tier
   - Fallback to standard encoding when quota exceeded

### 7.3 Revenue Model Recommendations

```typescript
const TIER_PRICING = {
  FREE: {
    monthly: 0,
    features: 'Up to 720p, 100MB files',
    premiumMinutes: 0
  },
  CREATOR: {
    monthly: 9.99,
    features: 'Up to 1080p, 500MB files, Early Play',
    premiumMinutes: 0
  },
  PARTNER: {
    monthly: 29.99,
    features: 'Up to 4K, 2GB files, Priority Processing',
    premiumMinutes: 100 // Included premium minutes
  },
  ENTERPRISE: {
    monthly: 99.99,
    features: 'Unlimited resolution, 10GB files, Max Priority',
    premiumMinutes: 500
  }
};
```

### 7.4 Break-even Analysis

For PARTNER tier at $29.99/month:
- Includes 100 premium minutes = $5 cost
- Storage for ~50 videos (1080p) = $2
- Bandwidth (1000 views) = $3
- **Margin**: $29.99 - $10 = $19.99 (66% margin)

## 8. Migration Plan

### 8.1 Phase 1: Infrastructure Setup (Week 1)
1. Create separate Bunny.net libraries for each tier
2. Configure library settings (resolutions, features)
3. Set up webhook endpoints
4. Deploy tier configuration system

### 8.2 Phase 2: API Implementation (Week 2)
1. Implement encoding settings endpoints
2. Update video upload with resolution control
3. Add processing status endpoint
4. Implement quota management

### 8.3 Phase 3: UI Development (Week 3)
1. Build resolution selector component
2. Add upload settings interface
3. Create channel encoding settings page
4. Implement processing status display

### 8.4 Phase 4: Testing & Optimization (Week 4)
1. Run integration tests
2. Load test premium encoding
3. Optimize webhook processing
4. Fine-tune quota limits

### 8.5 Phase 5: Gradual Rollout
1. Enable for internal testing (1 week)
2. Beta release to 10% of PARTNER users
3. Monitor costs and performance
4. Full rollout after validation

## 9. Monitoring & Analytics

### 9.1 Metrics to Track

```typescript
interface EncodingMetrics {
  // Performance
  avgEncodingTime: number;
  avgEncodingTimeByTier: Record<UserTier, number>;
  encodingSuccessRate: number;

  // Usage
  videosProcessedDaily: number;
  premiumMinutesUsedDaily: number;
  resolutionDistribution: Record<string, number>;

  // Cost
  dailyEncodingCost: number;
  dailyStorageCost: number;
  costPerVideo: number;

  // User Experience
  avgTimeToFirstPlay: number;
  bufferingEvents: number;
  resolutionSwitches: number;
}
```

### 9.2 Alerts

- Premium encoding quota exceeded for user
- Encoding failure rate > 5%
- Average encoding time > 30 minutes (standard)
- Average encoding time > 5 minutes (premium)
- Daily encoding cost > budget limit

## 10. Security Considerations

### 10.1 Input Validation
- Validate file size before upload
- Check video format/codec support
- Verify resolution requests against tier
- Sanitize webhook payloads

### 10.2 Rate Limiting
- Limit uploads per user per hour
- Limit re-encoding requests
- Throttle status polling requests

### 10.3 Access Control
- Verify video ownership for re-encoding
- Check tier authorization for features
- Audit log for encoding settings changes

## 11. Future Enhancements

### 11.1 Short Term (3 months)
- AI-powered auto-resolution selection based on content type
- Batch video processing interface
- Encoding templates for common use cases

### 11.2 Medium Term (6 months)
- Custom bitrate controls per resolution
- HDR/Dolby Vision support for Enterprise
- Live streaming resolution adaptation

### 11.3 Long Term (12 months)
- ML-based encoding optimization
- Per-video cost estimates before upload
- Advanced codec support (AV1, H.266)

## Conclusion

This implementation plan provides comprehensive control over video processing quality and priority within the constraints of Bunny.net's API. The tier-based system balances cost, performance, and user experience while providing clear upgrade paths for creators who need advanced features.

Key success factors:
- Clean tier separation with clear value propositions
- Real-time processing feedback
- Cost-effective default settings
- Smooth migration without disrupting existing videos

The system is designed to scale from free users with basic needs to enterprise customers requiring maximum quality and fastest processing times.