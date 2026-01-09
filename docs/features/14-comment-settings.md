# Comment Settings During Upload - Implementation Plan

**Document Version**: 1.0
**Last Updated**: 2025-01-20
**Status**: Ready for Implementation
**Priority**: HIGH
**Estimated Effort**: 2 weeks (1 developer)

---

## Executive Summary

This document outlines the implementation plan for adding comment settings during video upload, allowing creators to control comment moderation before their videos go public. This feature addresses the need for proactive comment moderation, particularly for sensitive Islamic topics.

**Key Features:**
- Comment moderation settings during upload
- Automated content filtering
- Manual review queue
- Blocked words and users management
- Pin and heart comment functionality

---

## Table of Contents

1. [Requirements](#requirements)
2. [Data Model](#data-model)
3. [API Design](#api-design)
4. [Upload Form UI](#upload-form-ui)
5. [Moderation Queue](#moderation-queue)
6. [Admin Dashboard](#admin-dashboard)
7. [Comment API Enforcement](#comment-api-enforcement)
8. [Technical Implementation](#technical-implementation)
9. [Testing Strategy](#testing-strategy)
10. [Migration Plan](#migration-plan)
11. [Security Considerations](#security-considerations)

---

## Requirements

### Functional Requirements

Based on YouTube comparison document, the system must support:

1. **Comment Control Options**:
   - Allow all comments (default)
   - Hold all comments for review
   - Hold potentially inappropriate comments (auto-filter)
   - Disable comments entirely

2. **Moderation Features**:
   - Blocked words list (per channel)
   - Blocked users list (per channel)
   - Pin comments to top
   - Heart comments (creator endorsement)

3. **Review Queue**:
   - Dashboard for reviewing held comments
   - Bulk approve/reject actions
   - Filter by reason held
   - Search functionality

### Non-Functional Requirements

- **Performance**: Comment filtering must not add >100ms latency
- **Scalability**: Support 10,000+ held comments per channel
- **Security**: Prevent bypass of disabled comments via API
- **Accessibility**: WCAG 2.1 AA compliance for moderation UI

### Use Cases

1. **Controversial Fiqh Topics**: Hold all comments for manual review
2. **Women Scholars**: Disable comments to prevent harassment
3. **Children's Content**: Disable comments (COPPA compliance)
4. **Breaking News**: Hold comments during fact-checking period
5. **General Content**: Auto-filter inappropriate language

---

## Data Model

### 1. Comment Settings Schema

```typescript
// packages/shared-types/src/video.ts - Extension
export interface CommentSettings {
  mode: CommentMode;
  autoFilterEnabled: boolean;
  blockedWords: string[];
  blockedUsers: string[]; // User IDs
  requireApproval: boolean;
  disableReason?: string; // If comments disabled
  coppaCompliance?: boolean; // For children's content
  dateModified: string;
}

export enum CommentMode {
  ALLOW_ALL = 'allow_all',           // Comments posted immediately
  HOLD_ALL = 'hold_all',             // All comments held for review
  HOLD_INAPPROPRIATE = 'hold_inappropriate', // Auto-filter suspicious
  DISABLED = 'disabled'               // No comments allowed
}

// Update VideoObject to include comment settings
export interface VideoObject extends Timestamps {
  // ... existing fields ...
  commentSettings?: CommentSettings;
}
```

### 2. Comment Moderation Schema

```typescript
// packages/shared-types/src/comment.ts - Extension
export interface CommentModerationStatus {
  status: 'pending' | 'approved' | 'rejected' | 'auto_filtered';
  reason?: string; // Why comment was held
  reviewedBy?: string; // User ID who reviewed
  reviewedAt?: string; // ISO timestamp
  filterScore?: number; // 0-1 confidence of inappropriate content
}

export interface Comment extends Timestamps, SoftDelete {
  // ... existing fields ...
  moderationStatus?: CommentModerationStatus;
  isHearted?: boolean; // Creator endorsement
  heartedAt?: string;
}
```

### 3. Channel Moderation Settings

```typescript
// packages/shared-types/src/channel.ts - New
export interface ChannelModerationSettings {
  id: string;
  channelId: string;
  globalBlockedWords: string[];
  globalBlockedUsers: string[];
  defaultCommentMode: CommentMode;
  autoFilterSensitivity: 'low' | 'medium' | 'high';
  notifyOnHeldComments: boolean;
  notifyEmail?: string;
  dateCreated: string;
  dateModified: string;
}
```

### 4. Moderation Queue Entry

```typescript
// packages/shared-types/src/moderation.ts - New
export interface ModerationQueueEntry {
  id: string;
  commentId: string;
  videoId: string;
  videoTitle: string;
  channelId: string;
  userId: string; // Commenter
  userDisplayName: string;
  content: string;
  reason: 'manual_hold' | 'auto_filter' | 'blocked_word' | 'blocked_user';
  filterDetails?: {
    triggeredWords?: string[];
    confidenceScore?: number;
  };
  status: 'pending' | 'approved' | 'rejected';
  priority: 'low' | 'medium' | 'high'; // Based on filter confidence
  dateCreated: string;
  dateReviewed?: string;
  reviewedBy?: string;
}
```

---

## API Design

### 1. Comment Settings Endpoints

```typescript
// apps/api-videos/src/endpoints/video/commentSettings.ts

// GET /api/videos/{id}/comment-settings
export class GetCommentSettings extends OpenAPIRoute {
  schema = {
    tags: ["Comments"],
    summary: "Get comment settings for a video",
    request: {
      params: z.object({
        id: Str({ description: "Video ID" }),
      }),
    },
    responses: {
      "200": {
        description: "Comment settings",
        content: {
          "application/json": {
            schema: CommentSettings,
          },
        },
      },
    },
  };
}

// PUT /api/videos/{id}/comment-settings
export class UpdateCommentSettings extends OpenAPIRoute {
  schema = {
    tags: ["Comments"],
    summary: "Update comment settings for a video",
    request: {
      params: z.object({
        id: Str({ description: "Video ID" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: CommentSettings,
          },
        },
      },
    },
  };
}
```

### 2. Moderation Queue Endpoints

```typescript
// apps/api-videos/src/endpoints/moderation/queue.ts

// GET /api/moderation/queue
export class GetModerationQueue extends OpenAPIRoute {
  schema = {
    tags: ["Moderation"],
    summary: "Get comments pending moderation",
    request: {
      query: z.object({
        channelId: Str().optional(),
        videoId: Str().optional(),
        status: z.enum(['pending', 'all']).optional(),
        reason: Str().optional(),
        limit: z.number().optional(),
        cursor: Str().optional(),
      }),
    },
  };
}

// POST /api/moderation/queue/{id}/approve
export class ApproveComment extends OpenAPIRoute {
  schema = {
    tags: ["Moderation"],
    summary: "Approve a held comment",
    request: {
      params: z.object({
        id: Str({ description: "Queue entry ID" }),
      }),
    },
  };
}

// POST /api/moderation/queue/{id}/reject
export class RejectComment extends OpenAPIRoute {
  schema = {
    tags: ["Moderation"],
    summary: "Reject a held comment",
    request: {
      params: z.object({
        id: Str({ description: "Queue entry ID" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              reason: Str().optional(),
              blockUser: Bool().optional(),
            }),
          },
        },
      },
    },
  };
}

// POST /api/moderation/queue/bulk-action
export class BulkModerationAction extends OpenAPIRoute {
  schema = {
    tags: ["Moderation"],
    summary: "Bulk approve/reject comments",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              ids: z.array(Str()),
              action: z.enum(['approve', 'reject']),
              reason: Str().optional(),
            }),
          },
        },
      },
    },
  };
}
```

### 3. Channel Moderation Settings

```typescript
// apps/api-videos/src/endpoints/channel/moderationSettings.ts

// GET /api/channels/{id}/moderation-settings
export class GetChannelModerationSettings extends OpenAPIRoute {
  schema = {
    tags: ["Channels", "Moderation"],
    summary: "Get channel-wide moderation settings",
  };
}

// PUT /api/channels/{id}/moderation-settings
export class UpdateChannelModerationSettings extends OpenAPIRoute {
  schema = {
    tags: ["Channels", "Moderation"],
    summary: "Update channel-wide moderation settings",
    request: {
      body: {
        content: {
          "application/json": {
            schema: ChannelModerationSettings,
          },
        },
      },
    },
  };
}
```

---

## Upload Form UI

### Component Structure

```tsx
// apps/web/src/components/videoUpload/CommentSettings.tsx

interface CommentSettingsProps {
  settings: CommentSettings;
  onChange: (settings: CommentSettings) => void;
  disabled?: boolean;
}

export function CommentSettings({ settings, onChange, disabled }: CommentSettingsProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">{t('upload.commentSettings')}</h3>

      {/* Comment Mode Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          {t('upload.commentMode')}
        </label>
        <RadioGroup value={settings.mode} onChange={(mode) => onChange({...settings, mode})}>
          <RadioOption value="allow_all">
            <div>
              <p className="font-medium">{t('upload.allowAllComments')}</p>
              <p className="text-sm text-gray-500">
                {t('upload.allowAllCommentsDesc')}
              </p>
            </div>
          </RadioOption>

          <RadioOption value="hold_inappropriate">
            <div>
              <p className="font-medium">{t('upload.holdInappropriate')}</p>
              <p className="text-sm text-gray-500">
                {t('upload.holdInappropriateDesc')}
              </p>
            </div>
          </RadioOption>

          <RadioOption value="hold_all">
            <div>
              <p className="font-medium">{t('upload.holdAllComments')}</p>
              <p className="text-sm text-gray-500">
                {t('upload.holdAllCommentsDesc')}
              </p>
            </div>
          </RadioOption>

          <RadioOption value="disabled">
            <div>
              <p className="font-medium">{t('upload.disableComments')}</p>
              <p className="text-sm text-gray-500">
                {t('upload.disableCommentsDesc')}
              </p>
            </div>
          </RadioOption>
        </RadioGroup>
      </div>

      {/* Disable Reason (if comments disabled) */}
      {settings.mode === 'disabled' && (
        <div>
          <label className="block text-sm font-medium mb-1">
            {t('upload.disableReason')}
          </label>
          <select
            value={settings.disableReason}
            onChange={(e) => onChange({...settings, disableReason: e.target.value})}
            className="w-full border rounded-md px-3 py-2"
          >
            <option value="creator_choice">{t('upload.creatorChoice')}</option>
            <option value="coppa">{t('upload.coppaCompliance')}</option>
            <option value="sensitive_topic">{t('upload.sensitiveTopic')}</option>
            <option value="temporary">{t('upload.temporaryDisable')}</option>
          </select>
        </div>
      )}

      {/* Auto-filter Settings */}
      {settings.mode === 'hold_inappropriate' && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="font-medium mb-2">{t('upload.autoFilterSettings')}</h4>

          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="autoFilter"
                checked={settings.autoFilterEnabled}
                onChange={(e) => onChange({...settings, autoFilterEnabled: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="autoFilter">
                {t('upload.enableAutoFilter')}
              </label>
            </div>

            {/* Blocked Words */}
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('upload.blockedWords')}
              </label>
              <BlockedWordsList
                words={settings.blockedWords}
                onChange={(words) => onChange({...settings, blockedWords: words})}
                placeholder={t('upload.addBlockedWord')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Advanced Options */}
      <details className="border rounded-lg p-4">
        <summary className="cursor-pointer font-medium">
          {t('upload.advancedCommentSettings')}
        </summary>

        <div className="mt-4 space-y-3">
          {/* Blocked Users */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('upload.blockedUsers')}
            </label>
            <BlockedUsersList
              userIds={settings.blockedUsers}
              onChange={(users) => onChange({...settings, blockedUsers: users})}
            />
          </div>

          {/* COPPA Compliance */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="coppa"
              checked={settings.coppaCompliance}
              onChange={(e) => onChange({...settings, coppaCompliance: e.target.checked})}
              className="mr-2"
            />
            <label htmlFor="coppa">
              {t('upload.madeForKids')}
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
```

### Integration with Upload Form

```tsx
// apps/web/src/components/videoUpload/index.tsx - Modification

// Add to VideoMetadata interface
interface VideoMetadata {
  // ... existing fields ...
  commentSettings: CommentSettings;
}

// Add to initial state
const [metadata, setMetadata] = useState<VideoMetadata>({
  // ... existing fields ...
  commentSettings: {
    mode: CommentMode.ALLOW_ALL,
    autoFilterEnabled: true,
    blockedWords: [],
    blockedUsers: [],
    requireApproval: false,
    dateModified: new Date().toISOString(),
  }
});

// Add CommentSettings component in the form
<CommentSettings
  settings={metadata.commentSettings}
  onChange={(settings) => setMetadata(prev => ({...prev, commentSettings: settings}))}
  disabled={uploadProgress?.state === 'uploading'}
/>

// Include in upload payload
const initiateResult = await initiateVideoUpload(
  {
    // ... existing fields ...
    commentSettings: metadata.commentSettings,
  },
  userId,
  channelId
);
```

---

## Moderation Queue

### Dashboard Component

```tsx
// apps/web/src/app/[locale]/studio/comments/moderation/page.tsx

export default function CommentModerationPage() {
  const { t } = useLanguage();
  const [queue, setQueue] = useState<ModerationQueueEntry[]>([]);
  const [filters, setFilters] = useState({
    status: 'pending',
    reason: 'all',
    videoId: null,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        {t('moderation.commentModeration')}
      </h1>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          title={t('moderation.pendingComments')}
          value={queue.filter(q => q.status === 'pending').length}
          color="yellow"
        />
        <StatCard
          title={t('moderation.autoFiltered')}
          value={queue.filter(q => q.reason === 'auto_filter').length}
          color="orange"
        />
        <StatCard
          title={t('moderation.approvedToday')}
          value={getTodayApproved()}
          color="green"
        />
        <StatCard
          title={t('moderation.rejectedToday')}
          value={getTodayRejected()}
          color="red"
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg p-4 mb-6">
        <div className="flex gap-4">
          <Select
            label={t('moderation.filterByReason')}
            value={filters.reason}
            onChange={(reason) => setFilters({...filters, reason})}
            options={[
              { value: 'all', label: t('moderation.allReasons') },
              { value: 'manual_hold', label: t('moderation.manualHold') },
              { value: 'auto_filter', label: t('moderation.autoFiltered') },
              { value: 'blocked_word', label: t('moderation.blockedWord') },
              { value: 'blocked_user', label: t('moderation.blockedUser') },
            ]}
          />

          <VideoSelector
            value={filters.videoId}
            onChange={(videoId) => setFilters({...filters, videoId})}
          />

          <SearchInput
            placeholder={t('moderation.searchComments')}
            onSearch={handleSearch}
          />
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <span>
              {t('moderation.selectedCount', { count: selectedIds.length })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkAction('approve')}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                {t('moderation.approveSelected')}
              </button>
              <button
                onClick={() => handleBulkAction('reject')}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('moderation.rejectSelected')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comment List */}
      <div className="space-y-4">
        {queue.map(entry => (
          <ModerationCard
            key={entry.id}
            entry={entry}
            selected={selectedIds.includes(entry.id)}
            onSelect={(selected) => handleSelect(entry.id, selected)}
            onApprove={() => handleApprove(entry.id)}
            onReject={() => handleReject(entry.id)}
          />
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
```

### Moderation Card Component

```tsx
// apps/web/src/components/moderation/ModerationCard.tsx

interface ModerationCardProps {
  entry: ModerationQueueEntry;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}

export function ModerationCard({ entry, selected, onSelect, onApprove, onReject }: ModerationCardProps) {
  const { t } = useLanguage();

  return (
    <div className={`bg-white rounded-lg border p-4 ${selected ? 'border-blue-500' : 'border-gray-200'}`}>
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="mt-1"
        />

        {/* Content */}
        <div className="flex-1">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{entry.userDisplayName}</span>
              <span className="text-sm text-gray-500">
                {formatTimeAgo(entry.dateCreated)}
              </span>
              {entry.reason === 'auto_filter' && (
                <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">
                  {t('moderation.autoFiltered')}
                </span>
              )}
              {entry.filterDetails?.triggeredWords && (
                <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded">
                  {t('moderation.triggeredWords')}: {entry.filterDetails.triggeredWords.join(', ')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onApprove}
                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                {t('moderation.approve')}
              </button>
              <button
                onClick={onReject}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('moderation.reject')}
              </button>
              <DropdownMenu>
                <MenuItem onClick={() => blockUser(entry.userId)}>
                  {t('moderation.blockUser')}
                </MenuItem>
                <MenuItem onClick={() => viewUserHistory(entry.userId)}>
                  {t('moderation.viewHistory')}
                </MenuItem>
              </DropdownMenu>
            </div>
          </div>

          {/* Comment Content */}
          <p className="text-gray-800 mb-2">{entry.content}</p>

          {/* Video Info */}
          <div className="text-sm text-gray-500">
            {t('moderation.onVideo')}:
            <Link href={`/watch/${entry.videoId}`} className="ml-1 text-blue-600 hover:underline">
              {entry.videoTitle}
            </Link>
          </div>

          {/* Filter Details */}
          {entry.filterDetails?.confidenceScore && (
            <div className="mt-2 text-sm text-gray-600">
              {t('moderation.confidenceScore')}: {(entry.filterDetails.confidenceScore * 100).toFixed(0)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Admin Dashboard

### Channel Settings Page

```tsx
// apps/web/src/app/[locale]/studio/settings/moderation/page.tsx

export default function ChannelModerationSettingsPage() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<ChannelModerationSettings>();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">
        {t('settings.commentModeration')}
      </h1>

      {/* Default Comment Mode */}
      <section className="bg-white rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">
          {t('settings.defaultCommentSettings')}
        </h2>

        <div className="space-y-4">
          <Select
            label={t('settings.defaultMode')}
            value={settings?.defaultCommentMode}
            onChange={handleDefaultModeChange}
            options={[
              { value: 'allow_all', label: t('settings.allowAll') },
              { value: 'hold_inappropriate', label: t('settings.holdInappropriate') },
              { value: 'hold_all', label: t('settings.holdAll') },
              { value: 'disabled', label: t('settings.disabled') },
            ]}
          />

          <p className="text-sm text-gray-600">
            {t('settings.defaultModeDescription')}
          </p>
        </div>
      </section>

      {/* Auto-Filter Settings */}
      <section className="bg-white rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">
          {t('settings.autoFilterSettings')}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              {t('settings.filterSensitivity')}
            </label>
            <RadioGroup
              value={settings?.autoFilterSensitivity}
              onChange={handleSensitivityChange}
            >
              <RadioOption value="low">
                <div>
                  <p className="font-medium">{t('settings.lowSensitivity')}</p>
                  <p className="text-sm text-gray-500">
                    {t('settings.lowSensitivityDesc')}
                  </p>
                </div>
              </RadioOption>
              <RadioOption value="medium">
                <div>
                  <p className="font-medium">{t('settings.mediumSensitivity')}</p>
                  <p className="text-sm text-gray-500">
                    {t('settings.mediumSensitivityDesc')}
                  </p>
                </div>
              </RadioOption>
              <RadioOption value="high">
                <div>
                  <p className="font-medium">{t('settings.highSensitivity')}</p>
                  <p className="text-sm text-gray-500">
                    {t('settings.highSensitivityDesc')}
                  </p>
                </div>
              </RadioOption>
            </RadioGroup>
          </div>
        </div>
      </section>

      {/* Global Blocked Words */}
      <section className="bg-white rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">
          {t('settings.globalBlockedWords')}
        </h2>

        <BlockedWordsManager
          words={settings?.globalBlockedWords || []}
          onChange={handleBlockedWordsChange}
          suggestions={getCommonBlockedWords()}
        />
      </section>

      {/* Global Blocked Users */}
      <section className="bg-white rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">
          {t('settings.globalBlockedUsers')}
        </h2>

        <BlockedUsersManager
          userIds={settings?.globalBlockedUsers || []}
          onChange={handleBlockedUsersChange}
        />
      </section>

      {/* Notifications */}
      <section className="bg-white rounded-lg p-6">
        <h2 className="text-lg font-medium mb-4">
          {t('settings.notifications')}
        </h2>

        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="notify"
              checked={settings?.notifyOnHeldComments}
              onChange={(e) => handleNotificationChange(e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="notify">
              {t('settings.notifyHeldComments')}
            </label>
          </div>

          {settings?.notifyOnHeldComments && (
            <input
              type="email"
              value={settings.notifyEmail}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder={t('settings.notificationEmail')}
              className="w-full border rounded-md px-3 py-2"
            />
          )}
        </div>
      </section>

      {/* Save Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {t('common.saveChanges')}
        </button>
      </div>
    </div>
  );
}
```

---

## Comment API Enforcement

### Comment Creation with Moderation

```typescript
// apps/api-videos/src/endpoints/video/commentCreate.ts - Modified

export class CommentCreate extends OpenAPIRoute {
  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { id: videoId } = request.params;
    const { channelId, userId } = request.headers;
    const { content } = request.body;

    // Get video with comment settings
    const bucket = c.env.videos;
    const repository = new R2Repository<Video>(bucket);
    const video = await repository.getObject(videoId);

    if (!video) {
      return c.json({ success: false, error: "Video not found" }, 404);
    }

    // Check if comments are disabled
    if (video.commentSettings?.mode === CommentMode.DISABLED) {
      return c.json({
        success: false,
        error: "Comments are disabled for this video",
        code: "COMMENTS_DISABLED"
      }, 403);
    }

    // Check if user is blocked
    const blockedUsers = [
      ...(video.commentSettings?.blockedUsers || []),
      ...(await getChannelBlockedUsers(c.env, video.channelId))
    ];

    if (blockedUsers.includes(userId)) {
      return c.json({
        success: false,
        error: "You are not allowed to comment on this video",
        code: "USER_BLOCKED"
      }, 403);
    }

    // Check for blocked words
    const blockedWords = [
      ...(video.commentSettings?.blockedWords || []),
      ...(await getChannelBlockedWords(c.env, video.channelId))
    ];

    const containsBlockedWord = checkBlockedWords(content, blockedWords);
    if (containsBlockedWord) {
      // Add to moderation queue instead of rejecting
      await addToModerationQueue(c.env, {
        commentId: crypto.randomUUID(),
        videoId,
        channelId: video.channelId,
        userId,
        content,
        reason: 'blocked_word',
        filterDetails: { triggeredWords: containsBlockedWord }
      });

      // Return success but don't show comment
      return c.json({
        success: true,
        message: "Comment submitted for review",
        status: "held_for_review"
      }, 200);
    }

    // Determine if comment needs moderation
    let moderationStatus: CommentModerationStatus | undefined;
    const commentMode = video.commentSettings?.mode || CommentMode.ALLOW_ALL;

    switch (commentMode) {
      case CommentMode.HOLD_ALL:
        moderationStatus = {
          status: 'pending',
          reason: 'Manual review required'
        };
        break;

      case CommentMode.HOLD_INAPPROPRIATE:
        if (video.commentSettings?.autoFilterEnabled) {
          const filterResult = await checkInappropriateContent(c.env, content);
          if (filterResult.isInappropriate) {
            moderationStatus = {
              status: 'auto_filtered',
              reason: 'Potentially inappropriate content detected',
              filterScore: filterResult.confidence
            };
          }
        }
        break;

      case CommentMode.ALLOW_ALL:
      default:
        // No moderation needed
        break;
    }

    // Create comment
    const comment = {
      id: crypto.randomUUID(),
      videoId,
      userId,
      channelId,
      content,
      moderationStatus,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      likesCount: 0,
      dislikesCount: 0,
      isPinned: false,
      isHearted: false,
    };

    // If comment needs moderation, add to queue
    if (moderationStatus) {
      await addToModerationQueue(c.env, {
        commentId: comment.id,
        videoId,
        channelId: video.channelId,
        userId,
        userDisplayName: await getUserDisplayName(c.env, userId),
        content,
        reason: moderationStatus.status === 'auto_filtered' ? 'auto_filter' : 'manual_hold',
        filterDetails: moderationStatus.filterScore ? {
          confidenceScore: moderationStatus.filterScore
        } : undefined,
        status: 'pending',
        priority: getPriority(moderationStatus),
        dateCreated: new Date().toISOString()
      });

      return c.json({
        success: true,
        message: "Comment submitted for review",
        status: "held_for_review"
      }, 200);
    }

    // Add comment directly if no moderation needed
    video.comments.push(comment);
    await repository.putObject(video.id, video);

    // Queue analytics event
    const queue = new Queue();
    await queue.send(MessageType.CommentCreate, {
      commentId: comment.id,
      videoId,
      userId,
      channelId,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      success: true,
      result: { comment }
    }, 201);
  }
}
```

### Content Filtering Service

```typescript
// apps/api-videos/src/lib/moderation/contentFilter.ts

interface FilterResult {
  isInappropriate: boolean;
  confidence: number;
  triggeredRules?: string[];
}

export async function checkInappropriateContent(
  env: Env,
  content: string,
  sensitivity: 'low' | 'medium' | 'high' = 'medium'
): Promise<FilterResult> {
  // Basic implementation - can be replaced with ML service

  // Check against known inappropriate patterns
  const patterns = await getInappropriatePatterns(env, sensitivity);
  const triggeredRules: string[] = [];
  let maxConfidence = 0;

  for (const pattern of patterns) {
    if (pattern.regex.test(content.toLowerCase())) {
      triggeredRules.push(pattern.name);
      maxConfidence = Math.max(maxConfidence, pattern.confidence);
    }
  }

  // Check for excessive caps (shouting)
  const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
  if (capsRatio > 0.7 && content.length > 10) {
    triggeredRules.push('excessive_caps');
    maxConfidence = Math.max(maxConfidence, 0.6);
  }

  // Check for spam patterns
  const urlCount = (content.match(/https?:\/\//g) || []).length;
  if (urlCount > 2) {
    triggeredRules.push('excessive_urls');
    maxConfidence = Math.max(maxConfidence, 0.7);
  }

  // Repetitive text detection
  const words = content.split(/\s+/);
  const uniqueWords = new Set(words);
  if (words.length > 5 && uniqueWords.size / words.length < 0.3) {
    triggeredRules.push('repetitive_text');
    maxConfidence = Math.max(maxConfidence, 0.5);
  }

  return {
    isInappropriate: maxConfidence > getThreshold(sensitivity),
    confidence: maxConfidence,
    triggeredRules: triggeredRules.length > 0 ? triggeredRules : undefined
  };
}

function getThreshold(sensitivity: 'low' | 'medium' | 'high'): number {
  switch (sensitivity) {
    case 'low': return 0.8;
    case 'medium': return 0.6;
    case 'high': return 0.4;
  }
}

export function checkBlockedWords(
  content: string,
  blockedWords: string[]
): string[] | null {
  const triggered: string[] = [];
  const contentLower = content.toLowerCase();

  for (const word of blockedWords) {
    // Check for word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${escapeRegex(word.toLowerCase())}\\b`);
    if (regex.test(contentLower)) {
      triggered.push(word);
    }
  }

  return triggered.length > 0 ? triggered : null;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

## Technical Implementation

### Files to Create

1. **Type Definitions**:
   - `packages/shared-types/src/moderation.ts` - Moderation types
   - Update `packages/shared-types/src/video.ts` - Add comment settings
   - Update `packages/shared-types/src/comment.ts` - Add moderation status
   - Update `packages/shared-types/src/channel.ts` - Channel moderation settings

2. **API Endpoints**:
   - `apps/api-videos/src/endpoints/video/commentSettings.ts`
   - `apps/api-videos/src/endpoints/moderation/queue.ts`
   - `apps/api-videos/src/endpoints/moderation/approve.ts`
   - `apps/api-videos/src/endpoints/moderation/reject.ts`
   - `apps/api-videos/src/endpoints/moderation/bulkAction.ts`
   - `apps/api-videos/src/endpoints/channel/moderationSettings.ts`

3. **Services**:
   - `apps/api-videos/src/lib/moderation/contentFilter.ts`
   - `apps/api-videos/src/lib/moderation/queue.ts`
   - `apps/api-videos/src/lib/moderation/patterns.ts`

4. **UI Components**:
   - `apps/web/src/components/videoUpload/CommentSettings.tsx`
   - `apps/web/src/components/moderation/ModerationCard.tsx`
   - `apps/web/src/components/moderation/ModerationQueue.tsx`
   - `apps/web/src/components/moderation/BlockedWordsList.tsx`
   - `apps/web/src/components/moderation/BlockedUsersList.tsx`

5. **Pages**:
   - `apps/web/src/app/[locale]/studio/comments/moderation/page.tsx`
   - `apps/web/src/app/[locale]/studio/settings/moderation/page.tsx`

### Files to Modify

1. **Upload Components**:
   - `apps/web/src/components/videoUpload/index.tsx` - Add comment settings
   - `apps/web/src/lib/actions/upload.ts` - Include settings in payload

2. **API Endpoints**:
   - `apps/api-videos/src/endpoints/video/uploadInitiate.ts` - Accept settings
   - `apps/api-videos/src/endpoints/video/commentCreate.ts` - Enforce settings
   - `apps/api-videos/src/endpoints/video/commentsList.ts` - Filter by status

3. **Data Models**:
   - `apps/api-videos/src/lib/types.ts` - Add moderation schemas

### Storage Structure

```typescript
// R2 Bucket Structure

// Moderation Queue (new bucket: moderation-queue)
{
  key: "queue/{channelId}/{entryId}",
  value: ModerationQueueEntry
}

// Channel Moderation Settings (in channels bucket)
{
  key: "channel/{channelId}/moderation-settings",
  value: ChannelModerationSettings
}

// Inappropriate Patterns (in KV store)
{
  key: "moderation:patterns:{sensitivity}",
  value: Pattern[]
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// apps/api-videos/src/__tests__/moderation/contentFilter.test.ts

describe('Content Filter', () => {
  it('should detect inappropriate content with high confidence', async () => {
    const result = await checkInappropriateContent(env, 'test offensive content');
    expect(result.isInappropriate).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('should detect blocked words', () => {
    const blocked = checkBlockedWords('This contains spam word', ['spam']);
    expect(blocked).toContain('spam');
  });

  it('should respect word boundaries', () => {
    const blocked = checkBlockedWords('This is asparagus', ['spam']);
    expect(blocked).toBeNull();
  });

  it('should handle different sensitivities', async () => {
    const highResult = await checkInappropriateContent(env, 'CAPS TEXT', 'high');
    const lowResult = await checkInappropriateContent(env, 'CAPS TEXT', 'low');
    expect(highResult.isInappropriate).toBe(true);
    expect(lowResult.isInappropriate).toBe(false);
  });
});
```

### Integration Tests

```typescript
// apps/api-videos/src/__tests__/endpoints/commentCreate.test.ts

describe('Comment Creation with Moderation', () => {
  it('should reject comments when disabled', async () => {
    const video = createVideo({
      commentSettings: { mode: CommentMode.DISABLED }
    });

    const response = await createComment(video.id, 'Test comment');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('COMMENTS_DISABLED');
  });

  it('should hold comments for review when mode is HOLD_ALL', async () => {
    const video = createVideo({
      commentSettings: { mode: CommentMode.HOLD_ALL }
    });

    const response = await createComment(video.id, 'Test comment');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('held_for_review');

    // Verify comment is in moderation queue
    const queue = await getModerationQueue(video.channelId);
    expect(queue).toHaveLength(1);
  });

  it('should auto-filter inappropriate content', async () => {
    const video = createVideo({
      commentSettings: {
        mode: CommentMode.HOLD_INAPPROPRIATE,
        autoFilterEnabled: true
      }
    });

    const response = await createComment(video.id, 'SPAM SPAM SPAM!!!');
    expect(response.body.status).toBe('held_for_review');
  });
});
```

### E2E Tests

```typescript
// apps/web/src/__tests__/e2e/commentModeration.test.ts

describe('Comment Moderation Flow', () => {
  it('should allow creator to moderate comments', async () => {
    // Upload video with hold all comments
    await uploadVideo({
      title: 'Test Video',
      commentSettings: { mode: 'hold_all' }
    });

    // Post comment as viewer
    await postComment('This is a test comment');

    // Navigate to moderation queue
    await page.goto('/studio/comments/moderation');

    // Should see pending comment
    await expect(page.locator('.moderation-card')).toHaveCount(1);

    // Approve comment
    await page.click('[data-test="approve-comment"]');

    // Comment should appear on video
    await page.goto('/watch/test-video');
    await expect(page.locator('.comment')).toContainText('This is a test comment');
  });
});
```

---

## Migration Plan

### Phase 1: Database Schema (Day 1-2)
1. Deploy type definitions to shared-types package
2. Update R2 schemas in API
3. Create moderation-queue R2 bucket
4. Deploy without UI changes

### Phase 2: API Implementation (Day 3-5)
1. Deploy comment settings endpoints
2. Deploy moderation queue endpoints
3. Update comment creation logic
4. Test with Postman/curl

### Phase 3: Upload UI (Day 6-7)
1. Add CommentSettings component
2. Integrate with upload form
3. Test upload with various settings
4. Deploy to staging

### Phase 4: Moderation Dashboard (Day 8-10)
1. Create moderation queue page
2. Implement bulk actions
3. Add channel settings page
4. Deploy to staging

### Phase 5: Testing & Launch (Day 11-14)
1. Complete test suite
2. Load testing for queue
3. Security audit
4. Production deployment
5. Monitor for issues

### Rollback Strategy
- Feature flag: `ENABLE_COMMENT_MODERATION`
- Default to `CommentMode.ALLOW_ALL` if issues
- Keep old comment creation endpoint as fallback
- Queue can be disabled without affecting comments

---

## Security Considerations

### 1. Authorization
- Only video owner can change comment settings
- Only channel owner can access moderation queue
- Viewers cannot see held comments

### 2. Rate Limiting
- Limit moderation actions to 100/minute
- Prevent spam in blocked words list (max 1000)
- Queue size limit per channel (10,000 pending)

### 3. Data Privacy
- Don't expose why comment was held to commenter
- Anonymize blocked user lists in API responses
- Log all moderation actions for audit

### 4. Input Validation
- Sanitize blocked words (prevent regex injection)
- Validate comment mode enum values
- Max comment length enforcement (2000 chars)

### 5. Content Security
- Escape HTML in comments
- Prevent XSS in moderation dashboard
- Validate URLs in comments

---

## Performance Considerations

### 1. Caching
- Cache channel moderation settings (5 min TTL)
- Cache blocked words/users lists (10 min TTL)
- Cache filter patterns (1 hour TTL)

### 2. Indexing
- Index moderation queue by:
  - channelId + status
  - videoId + status
  - dateCreated (for sorting)

### 3. Optimization
- Batch approve/reject operations
- Lazy load user details in queue
- Paginate queue (50 items per page)

### 4. Monitoring
- Track queue processing time
- Alert if queue > 1000 pending
- Monitor filter false positive rate

---

## Success Metrics

### KPIs to Track
1. **Adoption Rate**: % of uploads using non-default settings
2. **Moderation Volume**: Comments held per day
3. **Response Time**: Avg time to review held comment
4. **False Positive Rate**: % of approved from auto-filter
5. **User Satisfaction**: Creator survey on moderation tools

### Launch Criteria
- [ ] All comment modes working correctly
- [ ] Moderation queue handles 1000+ items
- [ ] Auto-filter accuracy > 80%
- [ ] Page load time < 2 seconds
- [ ] Zero security vulnerabilities

---

## Future Enhancements

### Phase 2 Features
1. **AI-Powered Filtering**: ML model for better detection
2. **Trusted Users**: Auto-approve comments from verified users
3. **Shadow Banning**: Hide comments without notification
4. **Keyword Alerts**: Notify on specific words/topics
5. **Community Moderation**: Let trusted users help moderate

### Phase 3 Features
1. **Moderation Analytics**: Dashboard with insights
2. **Bulk Import/Export**: Blocked words/users lists
3. **API for Third-Party Tools**: Webhook integration
4. **Mobile App Support**: Moderate from mobile
5. **Real-time Updates**: WebSocket for live queue

---

## Conclusion

This implementation plan provides a comprehensive approach to adding comment settings during upload. The phased approach ensures gradual rollout with minimal risk, while the moderation queue provides powerful tools for content creators to manage their community effectively.

The feature directly addresses creator needs identified in the YouTube comparison document, particularly for Islamic content creators who need careful moderation for sensitive religious topics.

**Next Steps**:
1. Review and approve this plan
2. Create GitHub issues for each component
3. Begin Phase 1 implementation
4. Set up staging environment for testing

---

**Document Maintained By**: Architecture Team
**Review Schedule**: Weekly during implementation
**Questions**: Contact @architect in Slack