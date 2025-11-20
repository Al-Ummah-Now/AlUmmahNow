# Series Detection Feature - Implementation Plan

**Document Version**: 1.0
**Created Date**: 2025-11-20
**Priority**: MEDIUM 🟡
**Estimated Effort**: 3 weeks (1-2 developers)
**Architecture Pattern**: Pattern Matching + R2 Storage + Auto-playlist Generation

---

## Executive Summary

The Series Detection feature automatically identifies video series from title patterns, groups related videos together, and creates playlists automatically. This feature improves content organization, viewer navigation, and binge-watching capabilities by intelligently detecting episodic content patterns like "Episode 1", "Part 1", "Lecture 1" commonly used in Islamic educational content.

## Key Requirements

### Functional Requirements
1. **Auto-detect series patterns** in video titles during upload/edit
2. **Pattern matching** for common series indicators (Episode, Part, Lecture, Session, etc.)
3. **Group related videos** automatically based on detected patterns
4. **Auto-create playlists** for confirmed series
5. **Manual confirmation UI** for series suggestions
6. **Bulk series assignment** for existing videos
7. **Series metadata management** (total episodes, episode order, series title)
8. **Smart episode numbering** detection (1, 01, I, One, etc.)

### Non-Functional Requirements
1. **Accuracy**: 95% precision in series detection
2. **Performance**: Pattern matching < 100ms per title
3. **Scalability**: Handle 100,000+ videos efficiently
4. **Flexibility**: Support custom pattern rules
5. **Internationalization**: Support Arabic/English patterns

## Technical Architecture

### Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Upload Form with Series Detection Preview                │   │
│  │  Series Confirmation Modal                                │   │
│  │  Series Management Dashboard                              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API (Hono - api-videos)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   Pattern Detection Service                               │   │
│  │   Series Management Endpoints                             │   │
│  │   Auto-playlist Creation Service                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Storage Layer (R2)                           │
│  ┌────────────────────┐    ┌──────────────────────────────┐    │
│  │   videos bucket    │    │     series bucket             │    │
│  │  (with series ID)  │    │  (series metadata)            │    │
│  └────────────────────┘    └──────────────────────────────┘    │
│  ┌────────────────────┐    ┌──────────────────────────────┐    │
│  │ playlists bucket   │    │  series-patterns bucket       │    │
│  │ (auto-generated)   │    │   (detection rules)           │    │
│  └────────────────────┘    └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│           Background Processor (Queue Consumer)                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Batch Series Detection for Existing Videos               │   │
│  │  Series Reindexing Jobs                                   │   │
│  │  Orphaned Episode Detection                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Upload/Edit** → Title entered → Pattern detection runs
2. **Series detected** → Suggestion shown to user
3. **User confirms** → Series created/updated
4. **Auto-playlist** → Generated and linked
5. **Background processing** → Finds related videos
6. **Continuous learning** → Pattern rules refined

## Pattern Detection Algorithm

### Core Pattern Matching Engine

**File**: `apps/api-videos/src/lib/series-detection/detector.ts`

```typescript
export interface SeriesPattern {
  id: string;
  name: string;
  regex: RegExp;
  priority: number;
  language: 'en' | 'ar' | 'any';
  extractors: {
    seriesTitle: (match: RegExpMatchArray) => string;
    episodeNumber: (match: RegExpMatchArray) => number;
    episodeTitle?: (match: RegExpMatchArray) => string | undefined;
  };
}

export interface DetectionResult {
  detected: boolean;
  confidence: number; // 0-100
  pattern: SeriesPattern | null;
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle?: string;
  suggestions: SeriesSuggestion[];
}

export interface SeriesSuggestion {
  seriesId?: string;        // Existing series ID if found
  seriesTitle: string;
  episodeNumber: number;
  confidence: number;
  matchedVideos: VideoMatch[];
}

export interface VideoMatch {
  videoId: string;
  title: string;
  episodeNumber: number;
  uploadDate: string;
}
```

### Default Pattern Rules

```typescript
const DEFAULT_PATTERNS: SeriesPattern[] = [
  {
    id: 'episode-number-colon',
    name: 'Episode Number with Colon',
    // Matches: "Episode 1: Introduction", "Episode 01: The Beginning"
    regex: /^(?:Episode|Ep\.?)\s*(\d+)\s*:\s*(.+)$/i,
    priority: 100,
    language: 'en',
    extractors: {
      seriesTitle: (match) => 'Series',
      episodeNumber: (match) => parseInt(match[1]),
      episodeTitle: (match) => match[2].trim(),
    }
  },
  {
    id: 'series-episode',
    name: 'Series Name - Episode Format',
    // Matches: "Tafsir Surah Al-Baqarah - Episode 1"
    regex: /^(.+?)\s*[-–]\s*(?:Episode|Ep\.?|Part|Pt\.?|Lecture|Session)\s*(\d+)(?:\s*[-–:]\s*(.+))?$/i,
    priority: 90,
    language: 'en',
    extractors: {
      seriesTitle: (match) => match[1].trim(),
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'part-of-series',
    name: 'Part X of Y Format',
    // Matches: "Part 1 of 10: Introduction"
    regex: /^Part\s*(\d+)\s*of\s*\d+\s*(?:[-–:]\s*(.+))?$/i,
    priority: 85,
    language: 'en',
    extractors: {
      seriesTitle: (match) => 'Series',
      episodeNumber: (match) => parseInt(match[1]),
      episodeTitle: (match) => match[2]?.trim(),
    }
  },
  {
    id: 'lecture-number',
    name: 'Lecture Number Format',
    // Matches: "Lecture 1", "Lecture #1", "Lecture 01"
    regex: /^(.+?)\s*(?:Lecture|Lesson|Class|Session)\s*#?(\d+)(?:\s*[-–:]\s*(.+))?$/i,
    priority: 80,
    language: 'en',
    extractors: {
      seriesTitle: (match) => match[1].trim() || 'Lecture Series',
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'numbered-parentheses',
    name: 'Number in Parentheses',
    // Matches: "Seerah of Prophet (1)", "Islamic History (01)"
    regex: /^(.+?)\s*\((\d+)\)(?:\s*[-–:]\s*(.+))?$/,
    priority: 75,
    language: 'any',
    extractors: {
      seriesTitle: (match) => match[1].trim(),
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'arabic-episode',
    name: 'Arabic Episode Format',
    // Matches: "الحلقة 1", "الجزء 1", "الدرس 1"
    regex: /^(.+?)\s*(?:الحلقة|الجزء|الدرس|المحاضرة)\s*(\d+)(?:\s*[-–:]\s*(.+))?$/,
    priority: 95,
    language: 'ar',
    extractors: {
      seriesTitle: (match) => match[1].trim() || 'سلسلة',
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'roman-numerals',
    name: 'Roman Numeral Format',
    // Matches: "Chapter I", "Part II", "Section III"
    regex: /^(.+?)\s*(?:Chapter|Part|Section)\s*(I{1,3}|IV|V|VI{1,3}|IX|X{1,3})(?:\s*[-–:]\s*(.+))?$/i,
    priority: 70,
    language: 'en',
    extractors: {
      seriesTitle: (match) => match[1].trim() || 'Series',
      episodeNumber: (match) => romanToNumber(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'day-number',
    name: 'Day Number Format',
    // Matches: "Day 1", "Day 01 - Ramadan Reflections"
    regex: /^(.+?)\s*Day\s*(\d+)(?:\s*[-–:]\s*(.+))?$/i,
    priority: 75,
    language: 'en',
    extractors: {
      seriesTitle: (match) => match[1].trim() || 'Daily Series',
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim(),
    }
  },
  {
    id: 'verse-by-verse',
    name: 'Verse by Verse Format',
    // Matches: "Surah Al-Baqarah Verses 1-5"
    regex: /^(Surah\s+.+?)\s+Verses?\s+(\d+)(?:-\d+)?(?:\s*[-–:]\s*(.+))?$/i,
    priority: 85,
    language: 'any',
    extractors: {
      seriesTitle: (match) => match[1].trim() + ' Tafsir',
      episodeNumber: (match) => parseInt(match[2]),
      episodeTitle: (match) => match[3]?.trim() || `Verses ${match[2]}`,
    }
  }
];
```

### Detection Algorithm Implementation

```typescript
export class SeriesDetector {
  private patterns: SeriesPattern[];
  private cache: Map<string, DetectionResult>;

  constructor(customPatterns?: SeriesPattern[]) {
    this.patterns = [...DEFAULT_PATTERNS, ...(customPatterns || [])]
      .sort((a, b) => b.priority - a.priority);
    this.cache = new Map();
  }

  async detect(title: string, context?: DetectionContext): Promise<DetectionResult> {
    // Check cache
    const cacheKey = `${title}:${context?.channelId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Try each pattern in priority order
    for (const pattern of this.patterns) {
      // Skip language-specific patterns if needed
      if (context?.language && pattern.language !== 'any' &&
          pattern.language !== context.language) {
        continue;
      }

      const match = title.match(pattern.regex);
      if (match) {
        const result = await this.processMatch(match, pattern, context);
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // No pattern matched
    const noMatch: DetectionResult = {
      detected: false,
      confidence: 0,
      pattern: null,
      seriesTitle: '',
      episodeNumber: 0,
      suggestions: []
    };

    this.cache.set(cacheKey, noMatch);
    return noMatch;
  }

  private async processMatch(
    match: RegExpMatchArray,
    pattern: SeriesPattern,
    context?: DetectionContext
  ): Promise<DetectionResult> {
    const seriesTitle = pattern.extractors.seriesTitle(match);
    const episodeNumber = pattern.extractors.episodeNumber(match);
    const episodeTitle = pattern.extractors.episodeTitle?.(match);

    // Calculate confidence based on various factors
    const confidence = this.calculateConfidence(
      seriesTitle,
      episodeNumber,
      pattern,
      context
    );

    // Find existing series or similar videos
    const suggestions = await this.findRelatedContent(
      seriesTitle,
      episodeNumber,
      context
    );

    return {
      detected: true,
      confidence,
      pattern,
      seriesTitle,
      episodeNumber,
      episodeTitle,
      suggestions
    };
  }

  private calculateConfidence(
    seriesTitle: string,
    episodeNumber: number,
    pattern: SeriesPattern,
    context?: DetectionContext
  ): number {
    let confidence = pattern.priority;

    // Adjust based on title quality
    if (seriesTitle.length < 3) confidence -= 20;
    if (seriesTitle.length > 100) confidence -= 10;

    // Adjust based on episode number
    if (episodeNumber > 1000) confidence -= 15;
    if (episodeNumber === 0) confidence -= 30;

    // Boost if channel has other series
    if (context?.channelHasSeries) confidence += 10;

    // Boost if similar videos exist
    if (context?.similarVideosCount && context.similarVideosCount > 2) {
      confidence += Math.min(20, context.similarVideosCount * 5);
    }

    return Math.max(0, Math.min(100, confidence));
  }

  private async findRelatedContent(
    seriesTitle: string,
    episodeNumber: number,
    context?: DetectionContext
  ): Promise<SeriesSuggestion[]> {
    if (!context?.channelId) return [];

    // Query for existing series with similar title
    const existingSeries = await this.queryExistingSeries(
      seriesTitle,
      context.channelId
    );

    // Query for videos with similar titles
    const similarVideos = await this.querySimilarVideos(
      seriesTitle,
      context.channelId
    );

    const suggestions: SeriesSuggestion[] = [];

    // Add existing series as suggestion
    if (existingSeries.length > 0) {
      for (const series of existingSeries) {
        suggestions.push({
          seriesId: series.id,
          seriesTitle: series.title,
          episodeNumber,
          confidence: this.calculateSimilarity(seriesTitle, series.title),
          matchedVideos: series.episodes.map(ep => ({
            videoId: ep.videoId,
            title: ep.title,
            episodeNumber: ep.number,
            uploadDate: ep.uploadDate
          }))
        });
      }
    }

    // Create new series suggestion from similar videos
    if (similarVideos.length >= 2) {
      const detectedEpisodes = await this.detectEpisodesInVideos(
        similarVideos,
        seriesTitle
      );

      if (detectedEpisodes.length >= 2) {
        suggestions.push({
          seriesTitle,
          episodeNumber,
          confidence: 80,
          matchedVideos: detectedEpisodes
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Implement string similarity algorithm (e.g., Levenshtein distance)
    // For now, simple case-insensitive comparison
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 100;
    if (s1.includes(s2) || s2.includes(s1)) return 80;

    // Calculate word overlap
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return Math.round((intersection.size / union.size) * 100);
  }
}
```

## Database Schema Changes

### 1. Series Model (`packages/shared-types/src/series.ts`)

```typescript
export interface SeriesObject extends Timestamps {
  id: string;
  channelId: string;
  userId: string;

  // Series metadata
  title: string;
  description?: string;
  thumbnailUrl?: string;

  // Detection metadata
  detectionPattern?: string;     // Pattern ID that detected this
  autoDetected: boolean;         // true if auto-detected, false if manual
  confirmedByUser: boolean;      // User confirmed the detection
  confidence?: number;            // Detection confidence score

  // Episode information
  totalEpisodes?: number;         // Known total (if series is complete)
  currentEpisodeCount: number;   // Current number of episodes
  episodes: SeriesEpisode[];     // Array of episodes

  // Playlist link
  playlistId?: string;            // Auto-generated playlist
  autoPlaylist: boolean;          // true if playlist was auto-created

  // Settings
  isActive: boolean;              // Still adding episodes
  sortOrder: 'asc' | 'desc';      // Episode order
  visibility: 'public' | 'private' | 'unlisted';

  // Statistics
  totalViews: number;
  totalDuration: number;          // Sum of all episode durations
  averageViewDuration: number;

  // Metadata
  tags?: string[];
  category?: string;
  language?: string;
}

export interface SeriesEpisode {
  videoId: string;
  episodeNumber: number;
  title: string;
  episodeTitle?: string;          // Episode-specific title
  duration: number;
  thumbnailUrl?: string;
  uploadDate: string;
  addedToSeries: string;          // When added to series
  manuallyAdded: boolean;         // vs auto-detected
}

export interface SeriesDetectionRequest {
  title: string;
  channelId: string;
  language?: 'en' | 'ar';
  existingVideoId?: string;       // If editing existing video
}

export interface SeriesConfirmationRequest {
  videoId: string;
  seriesId?: string;              // Existing series to add to
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle?: string;
  createPlaylist: boolean;
}

export interface SeriesBulkDetectionRequest {
  channelId: string;
  videoIds?: string[];            // Specific videos or all channel videos
  dryRun?: boolean;               // Preview without creating
}
```

### 2. Video Model Extensions (`packages/shared-types/src/video.ts`)

```typescript
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Series fields
  seriesId?: string;
  episodeNumber?: number;
  episodeTitle?: string;
  nextEpisodeId?: string;         // For navigation
  previousEpisodeId?: string;     // For navigation

  // Detection metadata
  seriesDetected?: boolean;
  seriesDetectionResult?: {
    pattern: string;
    confidence: number;
    suggestedTitle: string;
    suggestedNumber: number;
  };
}
```

### 3. Pattern Storage Model

```typescript
export interface PatternRule {
  id: string;
  name: string;
  description?: string;
  regex: string;                  // Stored as string, compiled at runtime
  priority: number;
  language: 'en' | 'ar' | 'any';
  isActive: boolean;
  isCustom: boolean;              // User-defined vs system
  createdBy?: string;
  usageCount: number;             // Track effectiveness
  successRate: number;            // Confirmation rate
}
```

## API Endpoint Specifications

### 1. Detect Series from Title

```typescript
POST /api/series/detect
Authorization: Bearer {token}

Request Body:
{
  "title": "Tafsir Surah Al-Baqarah - Episode 1: Introduction",
  "channelId": "channel123",
  "language": "en"
}

Response:
{
  "success": true,
  "result": {
    "detected": true,
    "confidence": 95,
    "seriesTitle": "Tafsir Surah Al-Baqarah",
    "episodeNumber": 1,
    "episodeTitle": "Introduction",
    "suggestions": [
      {
        "seriesId": "series123",
        "seriesTitle": "Tafsir Surah Al-Baqarah",
        "confidence": 100,
        "existingEpisodes": 5,
        "lastEpisode": 5
      }
    ]
  }
}
```

### 2. Confirm Series Detection

```typescript
POST /api/series/confirm
Authorization: Bearer {token}

Request Body:
{
  "videoId": "video123",
  "seriesId": "series123",  // or null to create new
  "seriesTitle": "Tafsir Surah Al-Baqarah",
  "episodeNumber": 6,
  "createPlaylist": true
}

Response:
{
  "success": true,
  "result": {
    "seriesId": "series123",
    "playlistId": "playlist456",
    "message": "Video added to series",
    "seriesUrl": "/series/series123",
    "playlistUrl": "/playlist/playlist456"
  }
}
```

### 3. Bulk Detect Series

```typescript
POST /api/series/bulk-detect
Authorization: Bearer {token}

Request Body:
{
  "channelId": "channel123",
  "dryRun": true
}

Response:
{
  "success": true,
  "result": {
    "totalVideos": 150,
    "detectedSeries": 5,
    "series": [
      {
        "seriesTitle": "Friday Khutbahs 2024",
        "episodes": 45,
        "videos": [/* video IDs */]
      },
      {
        "seriesTitle": "Ramadan Reflections",
        "episodes": 30,
        "videos": [/* video IDs */]
      }
    ],
    "unmatched": 20
  }
}
```

### 4. Get Series Details

```typescript
GET /api/series/{seriesId}
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "id": "series123",
    "title": "Tafsir Surah Al-Baqarah",
    "description": "Complete tafsir of Surah Al-Baqarah",
    "channelId": "channel123",
    "totalEpisodes": 45,
    "currentEpisodeCount": 30,
    "episodes": [
      {
        "videoId": "video1",
        "episodeNumber": 1,
        "title": "Episode 1: Introduction",
        "duration": 3600,
        "thumbnailUrl": "...",
        "views": 1000
      }
      // ... more episodes
    ],
    "playlistId": "playlist456",
    "totalViews": 45000,
    "totalDuration": 162000
  }
}
```

### 5. Update Series

```typescript
PATCH /api/series/{seriesId}
Authorization: Bearer {token}

Request Body:
{
  "title": "Updated Series Title",
  "description": "Updated description",
  "totalEpisodes": 50
}

Response:
{
  "success": true,
  "result": {
    "message": "Series updated successfully"
  }
}
```

### 6. Remove Video from Series

```typescript
DELETE /api/series/{seriesId}/episodes/{videoId}
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "message": "Video removed from series",
    "reindexed": true  // Episode numbers adjusted
  }
}
```

### 7. Reorder Episodes

```typescript
POST /api/series/{seriesId}/reorder
Authorization: Bearer {token}

Request Body:
{
  "episodes": [
    { "videoId": "video1", "episodeNumber": 1 },
    { "videoId": "video3", "episodeNumber": 2 },
    { "videoId": "video2", "episodeNumber": 3 }
  ]
}

Response:
{
  "success": true,
  "result": {
    "message": "Episodes reordered successfully"
  }
}
```

### 8. Manage Pattern Rules (Admin)

```typescript
GET /api/series/patterns
Authorization: Bearer {adminToken}

Response:
{
  "success": true,
  "result": {
    "patterns": [
      {
        "id": "episode-number-colon",
        "name": "Episode Number with Colon",
        "regex": "^(?:Episode|Ep\\.?)\\s*(\\d+)\\s*:\\s*(.+)$",
        "priority": 100,
        "usageCount": 1523,
        "successRate": 0.92
      }
      // ... more patterns
    ]
  }
}

POST /api/series/patterns
Authorization: Bearer {adminToken}

Request Body:
{
  "name": "Custom Pattern",
  "regex": "^Custom\\s*(\\d+)$",
  "priority": 50,
  "language": "en"
}
```

## Frontend UI Components

### 1. Upload Form Series Detection

**File**: `apps/web/src/components/videoUpload/SeriesDetection.tsx`

```typescript
interface SeriesDetectionProps {
  title: string;
  channelId: string;
  onSeriesConfirmed: (seriesData: SeriesConfirmation) => void;
}

export function SeriesDetection({ title, channelId, onSeriesConfirmed }: SeriesDetectionProps) {
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Debounce title changes
    const timer = setTimeout(() => {
      if (title.length > 5) {
        detectSeries(title);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [title]);

  const detectSeries = async (title: string) => {
    setLoading(true);
    try {
      const result = await api.detectSeries({ title, channelId });
      if (result.detected && result.confidence > 70) {
        setDetection(result);
        setShowModal(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Inline detection indicator */}
      {detection && !showModal && (
        <div className="mt-2 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Badge variant="info">Series Detected</Badge>
              <span className="text-sm">
                {detection.seriesTitle} - Episode {detection.episodeNumber}
              </span>
              <span className="text-xs text-gray-500">
                ({detection.confidence}% confidence)
              </span>
            </div>
            <Button size="sm" onClick={() => setShowModal(true)}>
              Review
            </Button>
          </div>
        </div>
      )}

      {/* Series confirmation modal */}
      {showModal && detection && (
        <SeriesConfirmationModal
          detection={detection}
          onConfirm={(data) => {
            onSeriesConfirmed(data);
            setShowModal(false);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}
```

### 2. Series Confirmation Modal

**File**: `apps/web/src/components/videoUpload/SeriesConfirmationModal.tsx`

```typescript
interface SeriesConfirmationModalProps {
  detection: DetectionResult;
  onConfirm: (data: SeriesConfirmation) => void;
  onCancel: () => void;
}

export function SeriesConfirmationModal({
  detection,
  onConfirm,
  onCancel
}: SeriesConfirmationModalProps) {
  const [selectedSeries, setSelectedSeries] = useState<string>('new');
  const [seriesTitle, setSeriesTitle] = useState(detection.seriesTitle);
  const [episodeNumber, setEpisodeNumber] = useState(detection.episodeNumber);
  const [createPlaylist, setCreatePlaylist] = useState(true);

  return (
    <Modal open onClose={onCancel}>
      <Modal.Header>
        <h3>Series Detected</h3>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          {/* Detection preview */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Detected pattern:</p>
            <p className="font-medium">{detection.pattern?.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>Series: <strong>{detection.seriesTitle}</strong></div>
              <div>Episode: <strong>{detection.episodeNumber}</strong></div>
            </div>
          </div>

          {/* Series selection */}
          {detection.suggestions.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Add to existing series or create new?
              </label>
              <RadioGroup value={selectedSeries} onChange={setSelectedSeries}>
                <RadioGroup.Option value="new">
                  Create new series
                </RadioGroup.Option>
                {detection.suggestions.map((suggestion) => (
                  <RadioGroup.Option
                    key={suggestion.seriesId}
                    value={suggestion.seriesId}
                  >
                    <div>
                      <p>{suggestion.seriesTitle}</p>
                      <p className="text-xs text-gray-500">
                        {suggestion.matchedVideos.length} existing episodes
                      </p>
                    </div>
                  </RadioGroup.Option>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Series title edit */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Series Title
            </label>
            <input
              type="text"
              value={seriesTitle}
              onChange={(e) => setSeriesTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Episode number edit */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Episode Number
            </label>
            <input
              type="number"
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg"
              min="1"
            />
          </div>

          {/* Auto-playlist option */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="createPlaylist"
              checked={createPlaylist}
              onChange={(e) => setCreatePlaylist(e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="createPlaylist" className="text-sm">
              Automatically create playlist for this series
            </label>
          </div>

          {/* Similar videos preview */}
          {detection.suggestions[0]?.matchedVideos.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Related videos found:</p>
              <div className="max-h-40 overflow-y-auto">
                {detection.suggestions[0].matchedVideos.slice(0, 5).map((video) => (
                  <div
                    key={video.videoId}
                    className="flex justify-between py-1 text-sm"
                  >
                    <span className="truncate">{video.title}</span>
                    <span className="text-gray-500">Ep. {video.episodeNumber}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Skip
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onConfirm({
              seriesId: selectedSeries === 'new' ? undefined : selectedSeries,
              seriesTitle,
              episodeNumber,
              createPlaylist
            });
          }}
        >
          Confirm Series
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

### 3. Series Management Dashboard

**File**: `apps/web/src/app/[locale]/dashboard/series/page.tsx`

```typescript
export default function SeriesDashboard() {
  const { t } = useLanguage();
  const [series, setSeries] = useState<SeriesObject[]>([]);
  const [bulkDetectionModal, setBulkDetectionModal] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">{t('dashboard.series.title')}</h1>
          <div className="space-x-2">
            <Button
              variant="secondary"
              onClick={() => setBulkDetectionModal(true)}
            >
              {t('dashboard.series.detectExisting')}
            </Button>
            <Button variant="primary">
              {t('dashboard.series.createNew')}
            </Button>
          </div>
        </div>

        {/* Series grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>

        {/* Bulk detection modal */}
        {bulkDetectionModal && (
          <BulkDetectionModal
            onClose={() => setBulkDetectionModal(false)}
            onComplete={(newSeries) => {
              setSeries([...series, ...newSeries]);
              setBulkDetectionModal(false);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
```

### 4. Series Card Component

**File**: `apps/web/src/components/series/SeriesCard.tsx`

```typescript
interface SeriesCardProps {
  series: SeriesObject;
}

export function SeriesCard({ series }: SeriesCardProps) {
  const router = useRouter();

  return (
    <div className="border rounded-lg p-4 hover:shadow-lg transition-shadow">
      {/* Series thumbnail */}
      <div className="aspect-video bg-gray-200 rounded mb-3">
        {series.thumbnailUrl ? (
          <img
            src={series.thumbnailUrl}
            alt={series.title}
            className="w-full h-full object-cover rounded"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-4xl text-gray-400">📚</span>
          </div>
        )}
      </div>

      {/* Series info */}
      <h3 className="font-semibold mb-1 truncate">{series.title}</h3>
      <div className="text-sm text-gray-600 space-y-1">
        <p>{series.currentEpisodeCount} episodes</p>
        <p>{formatDuration(series.totalDuration)}</p>
        <p>{series.totalViews.toLocaleString()} views</p>
      </div>

      {/* Detection badge */}
      {series.autoDetected && (
        <Badge variant="success" className="mt-2">
          Auto-detected
        </Badge>
      )}

      {/* Actions */}
      <div className="flex space-x-2 mt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => router.push(`/series/${series.id}/edit`)}
        >
          Edit
        </Button>
        <Button
          size="sm"
          onClick={() => router.push(`/series/${series.id}`)}
        >
          View
        </Button>
      </div>
    </div>
  );
}
```

### 5. Bulk Detection Modal

**File**: `apps/web/src/components/series/BulkDetectionModal.tsx`

```typescript
interface BulkDetectionModalProps {
  onClose: () => void;
  onComplete: (series: SeriesObject[]) => void;
}

export function BulkDetectionModal({ onClose, onComplete }: BulkDetectionModalProps) {
  const [step, setStep] = useState<'preview' | 'confirm' | 'processing'>('preview');
  const [detectionResult, setDetectionResult] = useState<BulkDetectionResult | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(new Set());

  const runDetection = async () => {
    const result = await api.bulkDetectSeries({
      channelId: currentChannel.id,
      dryRun: true
    });
    setDetectionResult(result);
  };

  const confirmSelection = async () => {
    setStep('processing');
    const result = await api.bulkDetectSeries({
      channelId: currentChannel.id,
      dryRun: false,
      seriesFilter: Array.from(selectedSeries)
    });
    onComplete(result.createdSeries);
  };

  return (
    <Modal open onClose={onClose} size="large">
      <Modal.Header>
        <h3>Detect Series in Existing Videos</h3>
      </Modal.Header>

      <Modal.Body>
        {step === 'preview' && (
          <div className="space-y-4">
            <p>This will scan your existing videos to detect series patterns.</p>
            <Button onClick={runDetection}>Start Detection</Button>

            {detectionResult && (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded">
                  <p className="text-sm">
                    Found {detectionResult.detectedSeries} potential series
                    in {detectionResult.totalVideos} videos
                  </p>
                </div>

                {detectionResult.series.map((series) => (
                  <div
                    key={series.seriesTitle}
                    className="border rounded p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">{series.seriesTitle}</h4>
                        <p className="text-sm text-gray-600">
                          {series.episodes} episodes detected
                        </p>
                      </div>
                      <Checkbox
                        checked={selectedSeries.has(series.seriesTitle)}
                        onChange={(checked) => {
                          const newSelection = new Set(selectedSeries);
                          if (checked) {
                            newSelection.add(series.seriesTitle);
                          } else {
                            newSelection.delete(series.seriesTitle);
                          }
                          setSelectedSeries(newSelection);
                        }}
                      />
                    </div>

                    {/* Preview episodes */}
                    <div className="mt-2 text-xs text-gray-500">
                      <details>
                        <summary className="cursor-pointer">
                          View episodes
                        </summary>
                        <div className="mt-1 space-y-1">
                          {series.videos.slice(0, 5).map((video, idx) => (
                            <div key={video}>Episode {idx + 1}: {video}</div>
                          ))}
                          {series.videos.length > 5 && (
                            <div>...and {series.videos.length - 5} more</div>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <p>Ready to create {selectedSeries.size} series:</p>
            <ul className="list-disc list-inside">
              {Array.from(selectedSeries).map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
            <p className="text-sm text-gray-600">
              Playlists will be automatically created for each series.
            </p>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-8">
            <Spinner size="large" />
            <p className="mt-4">Creating series and playlists...</p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        {step === 'preview' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => setStep('confirm')}
              disabled={selectedSeries.size === 0}
            >
              Continue ({selectedSeries.size} selected)
            </Button>
          </>
        )}
        {step === 'confirm' && (
          <>
            <Button variant="secondary" onClick={() => setStep('preview')}>
              Back
            </Button>
            <Button variant="primary" onClick={confirmSelection}>
              Create Series
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
```

## Testing Strategy

### 1. Unit Tests

**Pattern Detection Tests** (`apps/api-videos/src/lib/series-detection/__tests__/detector.test.ts`):

```typescript
describe('SeriesDetector', () => {
  const detector = new SeriesDetector();

  describe('Pattern Matching', () => {
    test.each([
      ['Episode 1: Introduction', 'Series', 1, 'Introduction'],
      ['Tafsir Al-Baqarah - Episode 1', 'Tafsir Al-Baqarah', 1, undefined],
      ['Lecture 5 - The Prayer', 'Lecture Series', 5, 'The Prayer'],
      ['Day 1 - Ramadan Reflections', 'Daily Series', 1, 'Ramadan Reflections'],
      ['الحلقة 1: المقدمة', 'سلسلة', 1, 'المقدمة'],
      ['Part III: The Journey', 'Series', 3, 'The Journey'],
      ['Surah Al-Baqarah Verses 1-5', 'Surah Al-Baqarah Tafsir', 1, 'Verses 1-5']
    ])('detects pattern in "%s"', async (title, expectedSeries, expectedEpisode, expectedTitle) => {
      const result = await detector.detect(title);
      expect(result.detected).toBe(true);
      expect(result.seriesTitle).toBe(expectedSeries);
      expect(result.episodeNumber).toBe(expectedEpisode);
      expect(result.episodeTitle).toBe(expectedTitle);
    });

    test('does not detect pattern in regular titles', async () => {
      const titles = [
        'Amazing Islamic Lecture',
        'How to Pray',
        'The Story of Prophet Muhammad'
      ];

      for (const title of titles) {
        const result = await detector.detect(title);
        expect(result.detected).toBe(false);
      }
    });
  });

  describe('Confidence Scoring', () => {
    test('high confidence for clear patterns', async () => {
      const result = await detector.detect('Episode 1: Clear Title');
      expect(result.confidence).toBeGreaterThan(90);
    });

    test('lower confidence for ambiguous patterns', async () => {
      const result = await detector.detect('1');
      expect(result.confidence).toBeLessThan(50);
    });
  });

  describe('Related Content', () => {
    test('finds existing series', async () => {
      // Mock existing series
      const context = {
        channelId: 'channel123',
        channelHasSeries: true,
        similarVideosCount: 5
      };

      const result = await detector.detect('Episode 6: New Episode', context);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].matchedVideos.length).toBe(5);
    });
  });
});
```

### 2. Integration Tests

**End-to-End Series Detection Flow**:

```typescript
describe('Series Detection E2E', () => {
  test('complete series detection flow', async () => {
    // 1. Upload video with series pattern in title
    const video = await uploadVideo({
      title: 'Tafsir Surah Al-Baqarah - Episode 1: Introduction'
    });

    // 2. Verify series was detected
    expect(video.seriesDetected).toBe(true);
    expect(video.seriesDetectionResult).toBeDefined();

    // 3. Confirm series
    const confirmation = await confirmSeries({
      videoId: video.id,
      seriesTitle: 'Tafsir Surah Al-Baqarah',
      episodeNumber: 1,
      createPlaylist: true
    });

    // 4. Verify series and playlist created
    expect(confirmation.seriesId).toBeDefined();
    expect(confirmation.playlistId).toBeDefined();

    // 5. Upload second episode
    const video2 = await uploadVideo({
      title: 'Tafsir Surah Al-Baqarah - Episode 2: Verses 1-5'
    });

    // 6. Verify it suggests existing series
    const detection = await detectSeries({ title: video2.title });
    expect(detection.suggestions[0].seriesId).toBe(confirmation.seriesId);
  });

  test('bulk detection on existing videos', async () => {
    // 1. Upload multiple videos
    const videos = await Promise.all([
      uploadVideo({ title: 'Friday Khutbah 1' }),
      uploadVideo({ title: 'Friday Khutbah 2' }),
      uploadVideo({ title: 'Friday Khutbah 3' })
    ]);

    // 2. Run bulk detection
    const result = await bulkDetectSeries({
      channelId: 'channel123',
      dryRun: false
    });

    // 3. Verify series created
    expect(result.detectedSeries).toBe(1);
    expect(result.series[0].episodes).toBe(3);
  });
});
```

### 3. Performance Tests

```typescript
describe('Performance', () => {
  test('pattern matching performance', async () => {
    const detector = new SeriesDetector();
    const titles = generateTestTitles(10000); // 10k titles

    const start = Date.now();
    for (const title of titles) {
      await detector.detect(title);
    }
    const duration = Date.now() - start;

    // Should process 10k titles in under 10 seconds
    expect(duration).toBeLessThan(10000);

    // Average per title < 1ms
    expect(duration / titles.length).toBeLessThan(1);
  });

  test('bulk detection scalability', async () => {
    // Test with 1000 videos
    const result = await bulkDetectSeries({
      channelId: 'test-channel',
      videoCount: 1000,
      dryRun: true
    });

    expect(result.processingTime).toBeLessThan(30000); // 30 seconds
  });
});
```

## Implementation Steps

### Phase 1: Core Detection Engine (Days 1-5)

1. **Pattern Detection Library**
   - [ ] Create `SeriesDetector` class
   - [ ] Implement default pattern rules
   - [ ] Add confidence scoring algorithm
   - [ ] Create pattern testing utilities
   - [ ] Add multi-language support (EN/AR)

2. **Database Schema**
   - [ ] Create `SeriesObject` type definition
   - [ ] Extend `VideoObject` with series fields
   - [ ] Create pattern storage schema
   - [ ] Update shared-types package

3. **R2 Storage Setup**
   - [ ] Create `series` bucket
   - [ ] Create `series-patterns` bucket
   - [ ] Define key structure for efficient queries

### Phase 2: API Development (Days 6-10)

4. **Detection APIs**
   - [ ] Create `/api/series/detect` endpoint
   - [ ] Create `/api/series/confirm` endpoint
   - [ ] Create `/api/series/bulk-detect` endpoint
   - [ ] Add OpenAPI documentation

5. **Management APIs**
   - [ ] CRUD operations for series
   - [ ] Episode management endpoints
   - [ ] Reordering functionality
   - [ ] Pattern management (admin)

6. **Integration with Existing**
   - [ ] Modify upload flow to detect series
   - [ ] Update video edit to show series
   - [ ] Auto-playlist creation logic
   - [ ] Navigation links (next/previous)

### Phase 3: Frontend Development (Days 11-15)

7. **Upload Enhancement**
   - [ ] Create `SeriesDetection` component
   - [ ] Create `SeriesConfirmationModal`
   - [ ] Add inline detection indicator
   - [ ] Integrate with upload form

8. **Series Dashboard**
   - [ ] Create series management page
   - [ ] Series card components
   - [ ] Bulk detection modal
   - [ ] Episode reordering UI

9. **Video Player Integration**
   - [ ] Show series info in player
   - [ ] Add next/previous episode buttons
   - [ ] Series playlist sidebar
   - [ ] Episode navigation

### Phase 4: Testing & Refinement (Days 16-18)

10. **Testing Suite**
    - [ ] Unit tests for pattern detection
    - [ ] Integration tests for full flow
    - [ ] Performance benchmarks
    - [ ] Multi-language pattern tests

11. **Optimization**
    - [ ] Cache detection results
    - [ ] Optimize pattern matching
    - [ ] Batch processing for bulk detection
    - [ ] Index series for fast queries

### Phase 5: Documentation & Deployment (Days 19-21)

12. **Documentation**
    - [ ] User guide for series feature
    - [ ] Pattern syntax documentation
    - [ ] API documentation
    - [ ] Admin guide for patterns

13. **Production Deployment**
    - [ ] Deploy detection service
    - [ ] Migrate existing videos (optional)
    - [ ] Monitor detection accuracy
    - [ ] Gather user feedback

## Migration Plan

### For Existing Videos

1. **Opt-in Migration**
   - Provide bulk detection tool in dashboard
   - Allow channel owners to review and confirm
   - No automatic changes to existing content

2. **Gradual Rollout**
   - Start with channels that opt-in
   - Monitor accuracy and adjust patterns
   - Full rollout after validation

### Migration Script

```typescript
async function migrateExistingVideos(channelId: string) {
  // 1. Fetch all videos for channel
  const videos = await fetchChannelVideos(channelId);

  // 2. Run detection on each
  const detections = await Promise.all(
    videos.map(v => detector.detect(v.title))
  );

  // 3. Group by series
  const seriesMap = groupBySeriesTitle(detections);

  // 4. Create series for confirmed groups
  for (const [title, episodes] of seriesMap) {
    if (episodes.length >= 2) {
      await createSeriesFromVideos(title, episodes);
    }
  }
}
```

## Success Metrics

### Key Performance Indicators (KPIs)

1. **Detection Accuracy**
   - Target: 95% precision (correct detections / total detections)
   - Target: 85% recall (detected series / actual series)

2. **User Adoption**
   - Target: 40% of new uploads use series feature within 3 months
   - Target: 20% of existing videos organized into series

3. **Engagement Impact**
   - Target: 25% increase in episode-to-episode viewing
   - Target: 15% increase in average session duration

4. **Performance**
   - Target: < 100ms detection time per title
   - Target: < 30s for bulk detection of 1000 videos

### Monitoring Dashboard

Create dashboard showing:
- Detection rate (daily/weekly)
- Confidence score distribution
- Popular series patterns
- False positive rate
- User confirmation rate
- Series viewing patterns

## Security Considerations

1. **Input Validation**
   - Sanitize regex patterns to prevent ReDoS attacks
   - Limit pattern complexity
   - Validate episode numbers (reasonable range)

2. **Rate Limiting**
   - Max 100 detection requests per minute per user
   - Max 10 bulk detections per day per channel

3. **Access Control**
   - Only video owner can confirm series
   - Admin-only pattern management
   - Channel-scoped series (no cross-channel series)

## Cost Analysis

### Cloudflare Workers Costs

**Detection Service**:
- Requests: ~1000 per hour = 720,000/month
- CPU Time: ~50ms per detection = 10 hours/month
- **Estimated Cost**: $10-15/month

**R2 Storage**:
- Series metadata: ~2KB per series
- 10,000 series = 20MB
- Pattern rules: < 1MB
- **Estimated Cost**: < $1/month

**Total Additional Cost**: ~$15/month

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Poor pattern accuracy | Medium | High | Extensive testing, user confirmation required |
| Performance degradation | Low | Medium | Caching, optimized patterns |
| User confusion | Medium | Medium | Clear UI, good documentation |
| Over-detection (false positives) | Medium | Low | Conservative confidence thresholds |
| Language-specific issues | Medium | Medium | Separate patterns per language |

## Future Enhancements

### Phase 2 Features
1. **Custom Pattern Creation** - Users define their own patterns
2. **Series Templates** - Predefined series structures
3. **Auto-episode Titles** - Generate from series + number
4. **Series Analytics** - Detailed viewing patterns
5. **Cross-series Navigation** - Related series suggestions

### Phase 3 Features
1. **ML-based Detection** - Train on confirmed series
2. **Series Completion Tracking** - User progress
3. **Series Subscriptions** - Notify on new episodes
4. **Collaborative Series** - Multiple creators
5. **Series Landing Pages** - Dedicated series URLs

## Appendix

### A. Common Islamic Content Patterns

```typescript
const ISLAMIC_PATTERNS = [
  // Quran Tafsir
  'Tafsir Surah {name} - Part {number}',
  'Surah {name} Verses {start}-{end}',
  '{name} Tafsir Episode {number}',

  // Hadith Series
  'Hadith {number}: {title}',
  '40 Hadith Nawawi - Hadith {number}',

  // Seerah
  'Seerah Part {number}',
  'Life of Prophet {name} - Episode {number}',

  // Ramadan Series
  'Ramadan Day {number}',
  'Ramadan Reflections {number}',

  // Friday Sermons
  'Friday Khutbah {date}',
  'Jummah Khutbah #{number}'
];
```

### B. Roman Numeral Conversion

```typescript
function romanToNumber(roman: string): number {
  const values: { [key: string]: number } = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50,
    'C': 100, 'D': 500, 'M': 1000
  };

  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const curr = values[roman[i]];
    const next = values[roman[i + 1]];

    if (next && curr < next) {
      result -= curr;
    } else {
      result += curr;
    }
  }

  return result;
}
```

### C. Sample API Requests

```bash
# Detect series from title
curl -X POST https://api.alummahnow.net/api/series/detect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Tafsir Surah Al-Baqarah - Episode 1",
    "channelId": "channel123"
  }'

# Confirm series
curl -X POST https://api.alummahnow.net/api/series/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": "video123",
    "seriesTitle": "Tafsir Surah Al-Baqarah",
    "episodeNumber": 1,
    "createPlaylist": true
  }'

# Bulk detect
curl -X POST https://api.alummahnow.net/api/series/bulk-detect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "channel123",
    "dryRun": true
  }'
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-20 | System Architect | Initial implementation plan |

---

## Sign-off

- [ ] Technical Lead Approval
- [ ] Product Manager Approval
- [ ] Frontend Team Review
- [ ] Backend Team Review

**Next Steps**: Review plan → Create implementation tasks → Begin Phase 1