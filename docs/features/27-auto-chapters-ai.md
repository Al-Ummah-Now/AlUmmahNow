# Auto-Chapters (AI Detection) Implementation Plan

**Document Version**: 1.0
**Created**: 2025-01-20
**Author**: System Architect Agent
**Priority**: LOW (Build on #4 Manual Chapters)
**Estimated Effort**: 3-4 weeks (2 developers)
**Prerequisite**: Feature #4 (Video Chapters) must be implemented first

---

## Executive Summary

This document provides a comprehensive implementation plan for AI-powered automatic chapter detection and generation for Al Ummah Now. This feature uses machine learning and audio/video analysis to automatically detect chapter boundaries and generate descriptive titles, reducing manual work for content creators.

**Key Value Proposition**:
- **Time Savings**: Eliminate manual timestamp creation for long lectures
- **Consistency**: Standardized chapter structure across content
- **Accessibility**: Make long-form content more navigable
- **Creator Experience**: One-click chapter generation
- **Quality**: AI-generated titles can be reviewed and edited

**Important Note**: This is a LOW priority feature (#32 in YouTube comparison). Manual chapters (#4) must be implemented first. Auto-chapters are a convenience enhancement, not a critical feature.

---

## Table of Contents

1. [Feature Requirements](#feature-requirements)
2. [AI/ML Service Integration Options](#aiml-service-integration-options)
3. [Chapter Detection Algorithm](#chapter-detection-algorithm)
4. [Title Generation System](#title-generation-system)
5. [Creator Review/Approval Workflow](#creator-reviewapproval-workflow)
6. [Technical Architecture](#technical-architecture)
7. [Implementation Details](#implementation-details)
8. [Files to Create/Modify](#files-to-createmodify)
9. [Testing Strategy](#testing-strategy)
10. [Cost Analysis](#cost-analysis)
11. [Migration Plan](#migration-plan)
12. [Success Metrics](#success-metrics)

---

## Feature Requirements

### Functional Requirements

From `docs/YOUTUBE_FEATURE_COMPARISON.md`:

1. **AI Chapter Detection**
   - Detect chapter breaks from audio silence/pauses
   - Analyze visual scene changes
   - Identify speech topic transitions
   - Minimum chapter duration: 10 seconds
   - Maximum chapters: 100 per video

2. **Automatic Title Generation**
   - Generate descriptive chapter titles
   - Support bilingual titles (English + Arabic)
   - Use speech-to-text for context
   - Apply Islamic content vocabulary

3. **Creator Review Workflow**
   - AI-generated chapters require approval
   - Visual timeline editor for adjustments
   - Merge/split chapter boundaries
   - Edit generated titles
   - Bulk operations (accept all, reject all)

4. **Quality Assurance**
   - Confidence scores for each detected chapter
   - Flag low-confidence detections for review
   - Manual override option
   - Fallback to manual chapter creation

### Non-Functional Requirements

1. **Performance**
   - Process videos asynchronously (background job)
   - Progress tracking with webhooks
   - 10-minute video: < 2 minutes processing
   - 60-minute video: < 10 minutes processing

2. **Accuracy**
   - Chapter boundary accuracy: > 85%
   - Title relevance score: > 75%
   - Reduce false positives (over-segmentation)

3. **Cost Efficiency**
   - Process only on creator request (opt-in)
   - Cache analysis results
   - Use efficient AI models (not GPT-4)

4. **Internationalization**
   - Support Arabic and English speech
   - RTL-aware title generation
   - Language detection for mixed content

---

## AI/ML Service Integration Options

### Option 1: AssemblyAI (Recommended for Phase 1)

**Capabilities**:
- Auto Chapters API (built-in feature)
- Speech-to-text with chapter detection
- Speaker diarization
- Topic detection
- Sentiment analysis

**Pricing**:
- $0.015/minute for transcription
- $0.0025/minute for auto chapters
- Total: ~$0.02/minute
- Example: 60-minute video = $1.20

**API Example**:
```typescript
import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_KEY });

// Start transcription with auto chapters
const transcript = await client.transcripts.create({
  audio_url: videoAudioUrl,
  auto_chapters: true,
  language_code: 'ar', // or 'en'
  speaker_labels: true,
  punctuate: true,
  format_text: true
});

// Wait for completion
const result = await client.transcripts.waitUntilReady(transcript.id);

// Get chapters
const chapters = result.chapters?.map(chapter => ({
  start: chapter.start,
  end: chapter.end,
  title: chapter.headline,
  summary: chapter.summary,
  confidence: chapter.confidence
}));
```

**Advantages**:
- Native auto-chapters feature (no custom ML needed)
- High accuracy for English and Arabic
- Fast processing (2-3x realtime)
- WebSocket progress tracking
- 5 hours free tier per month

**Disadvantages**:
- External API dependency
- Network latency
- Limited Islamic vocabulary training

**Recommendation**: ✅ **Best for Phase 1** - Fastest time to market

---

### Option 2: Deepgram

**Capabilities**:
- Speech-to-text with topic detection
- Paragraph detection (can serve as chapters)
- Multi-language support
- Custom vocabulary training

**Pricing**:
- $0.0125/minute for transcription
- $0.003/minute for topic detection
- Total: ~$0.016/minute
- Example: 60-minute video = $0.96

**API Example**:
```typescript
import { createClient } from '@deepgram/sdk';

const deepgram = createClient(process.env.DEEPGRAM_KEY);

const response = await deepgram.listen.prerecorded.transcribeUrl({
  url: videoAudioUrl,
  detect_topics: true,
  paragraphs: true,
  language: 'ar',
  model: 'nova-2'
});

// Extract paragraphs as chapter boundaries
const chapters = response.results.paragraphs.paragraphs.map(para => ({
  start: para.start,
  end: para.end,
  text: para.sentences.map(s => s.text).join(' ')
}));
```

**Advantages**:
- Lower cost than AssemblyAI
- Custom vocabulary support (Islamic terms)
- Fast processing (1.5-2x realtime)
- Good Arabic support

**Disadvantages**:
- No built-in chapter titles (need additional processing)
- Paragraph detection less accurate than dedicated chapters
- Requires GPT for title generation (extra cost)

**Recommendation**: Consider for Phase 2 cost optimization

---

### Option 3: OpenAI Whisper + GPT-4 (Hybrid Approach)

**Capabilities**:
- Whisper: Speech-to-text with word-level timestamps
- GPT-4: Analyze transcript and generate chapters

**Pricing**:
- Whisper: $0.006/minute
- GPT-4 Turbo: $0.01 per 1K input tokens, $0.03 per 1K output tokens
- Estimated total: $0.02-0.05/minute
- Example: 60-minute video = $1.20-$3.00

**API Example**:
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// Step 1: Transcribe with Whisper
const transcription = await openai.audio.transcriptions.create({
  file: audioFile,
  model: 'whisper-1',
  response_format: 'verbose_json',
  timestamp_granularities: ['word']
});

// Step 2: Analyze with GPT-4 to detect chapters
const completion = await openai.chat.completions.create({
  model: 'gpt-4-turbo',
  messages: [{
    role: 'system',
    content: `You are an AI that detects chapter boundaries in Islamic lectures.
    Analyze the transcript and suggest logical chapter breaks based on:
    - Topic shifts (e.g., Tafsir -> Hadith -> Dua)
    - Long pauses (silence > 3 seconds)
    - Speaker changes
    - Structural cues (e.g., "Now let's discuss...", "Moving on to...")

    Return chapters as JSON with start_time, end_time, and title in both English and Arabic.`
  }, {
    role: 'user',
    content: JSON.stringify(transcription.words)
  }],
  response_format: { type: 'json_object' }
});

const chapters = JSON.parse(completion.choices[0].message.content);
```

**Advantages**:
- Highest quality transcription (Whisper is open-source leader)
- GPT-4 understands Islamic context
- Bilingual title generation (English + Arabic)
- Custom prompts for specific content types

**Disadvantages**:
- Most expensive option
- Two API calls (slower)
- GPT-4 can hallucinate titles
- Requires custom logic for silence detection

**Recommendation**: Use for high-value content or as fallback

---

### Option 4: Self-Hosted ML (Future Consideration)

**Approach**: Run open-source models on Cloudflare AI or AWS Lambda
- Whisper for transcription
- PyAnnotate for speaker diarization
- Custom silence detection
- BERT/GPT-2 for title generation

**Advantages**:
- No per-minute costs
- Full control over models
- Privacy (no data sent externally)

**Disadvantages**:
- High development effort (8+ weeks)
- Infrastructure costs
- Maintenance burden
- Likely lower accuracy than commercial APIs

**Recommendation**: ❌ Not recommended for Phase 1

---

## Chapter Detection Algorithm

### Multi-Modal Detection Strategy

Combine multiple signals to detect chapter boundaries:

```
Chapter Boundary Score = (Audio Score × 0.4) + (Visual Score × 0.3) + (Transcript Score × 0.3)

If Score > Threshold (0.6), mark as chapter boundary
```

### 1. Audio Analysis (Silence Detection)

**Algorithm**:
```typescript
interface SilenceSegment {
  start: number;  // seconds
  end: number;    // seconds
  duration: number;
}

/**
 * Detect silence in audio using WebAudio API
 * Silence = audio below -40dB for 2+ seconds
 */
async function detectSilence(audioUrl: string): Promise<SilenceSegment[]> {
  // Use FFmpeg to extract audio amplitude data
  const amplitudeData = await extractAudioAmplitude(audioUrl);

  const silenceThreshold = -40; // dB
  const minSilenceDuration = 2; // seconds
  const silenceSegments: SilenceSegment[] = [];

  let silenceStart: number | null = null;

  for (let i = 0; i < amplitudeData.length; i++) {
    const time = i * 0.1; // 100ms resolution
    const db = amplitudeData[i];

    if (db < silenceThreshold) {
      if (silenceStart === null) {
        silenceStart = time;
      }
    } else {
      if (silenceStart !== null) {
        const duration = time - silenceStart;
        if (duration >= minSilenceDuration) {
          silenceSegments.push({
            start: silenceStart,
            end: time,
            duration
          });
        }
        silenceStart = null;
      }
    }
  }

  return silenceSegments;
}
```

**Scoring**:
- Silence > 3 seconds: Strong boundary (score = 1.0)
- Silence 2-3 seconds: Medium boundary (score = 0.6)
- Silence < 2 seconds: Weak boundary (score = 0.2)

### 2. Visual Analysis (Scene Change Detection)

**Algorithm**:
```typescript
interface SceneChange {
  timestamp: number;
  confidence: number;
  type: 'cut' | 'fade' | 'slide_change';
}

/**
 * Detect scene changes using frame-by-frame comparison
 * Uses histogram difference or optical flow
 */
async function detectSceneChanges(videoUrl: string): Promise<SceneChange[]> {
  // Use FFmpeg to extract keyframes
  const keyframes = await extractKeyframes(videoUrl, { interval: 1 }); // 1 per second

  const sceneChanges: SceneChange[] = [];

  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1];
    const current = keyframes[i];

    // Calculate histogram difference
    const diff = compareFrames(prev.data, current.data);

    if (diff > 0.3) { // 30% change threshold
      sceneChanges.push({
        timestamp: current.timestamp,
        confidence: Math.min(diff, 1.0),
        type: diff > 0.7 ? 'cut' : 'fade'
      });
    }
  }

  return sceneChanges;
}

function compareFrames(frame1: ImageData, frame2: ImageData): number {
  // Use histogram comparison (simplified)
  const hist1 = computeHistogram(frame1);
  const hist2 = computeHistogram(frame2);

  // Chi-square distance
  let distance = 0;
  for (let i = 0; i < hist1.length; i++) {
    const sum = hist1[i] + hist2[i];
    if (sum > 0) {
      distance += Math.pow(hist1[i] - hist2[i], 2) / sum;
    }
  }

  return Math.min(distance / hist1.length, 1.0);
}
```

**Scoring**:
- Hard cut (diff > 0.7): Strong boundary (score = 1.0)
- Fade/dissolve (diff 0.4-0.7): Medium boundary (score = 0.7)
- Slide change in presentation: Strong boundary (score = 0.9)

### 3. Transcript Analysis (Topic Transition)

**Algorithm**:
```typescript
interface TopicTransition {
  timestamp: number;
  previousTopic: string;
  newTopic: string;
  confidence: number;
}

/**
 * Detect topic changes using sentence embeddings
 */
async function detectTopicTransitions(
  transcript: TranscriptSegment[]
): Promise<TopicTransition[]> {
  const transitions: TopicTransition[] = [];

  // Use sliding window approach
  const windowSize = 5; // sentences

  for (let i = windowSize; i < transcript.length - windowSize; i++) {
    const before = transcript.slice(i - windowSize, i);
    const after = transcript.slice(i, i + windowSize);

    // Get topic embeddings using sentence-transformers
    const beforeEmbedding = await getTopicEmbedding(before);
    const afterEmbedding = await getTopicEmbedding(after);

    // Calculate cosine similarity
    const similarity = cosineSimilarity(beforeEmbedding, afterEmbedding);

    // Low similarity = topic change
    if (similarity < 0.5) {
      transitions.push({
        timestamp: transcript[i].start,
        previousTopic: extractTopic(before),
        newTopic: extractTopic(after),
        confidence: 1 - similarity
      });
    }
  }

  return transitions;
}
```

**Scoring**:
- Explicit transition phrases: Strong boundary (score = 1.0)
  - "Now let's discuss..."
  - "Moving on to..."
  - "Next topic..."
- Topic embedding shift > 50%: Medium boundary (score = 0.7)
- Speaker change: Weak boundary (score = 0.4)

### 4. Combined Scoring

```typescript
interface ChapterBoundary {
  timestamp: number;
  score: number;
  signals: {
    audio: number;
    visual: number;
    transcript: number;
  };
}

function combineSignals(
  silences: SilenceSegment[],
  sceneChanges: SceneChange[],
  topicTransitions: TopicTransition[]
): ChapterBoundary[] {
  const boundaries = new Map<number, ChapterBoundary>();

  // Aggregate all signals within 5-second windows
  const timeWindow = 5; // seconds

  // Process silence signals (weight: 0.4)
  for (const silence of silences) {
    const timestamp = Math.round(silence.end);
    const score = silence.duration >= 3 ? 1.0 : 0.6;
    addOrUpdateBoundary(boundaries, timestamp, { audio: score }, timeWindow);
  }

  // Process visual signals (weight: 0.3)
  for (const scene of sceneChanges) {
    const timestamp = Math.round(scene.timestamp);
    addOrUpdateBoundary(boundaries, timestamp, { visual: scene.confidence }, timeWindow);
  }

  // Process transcript signals (weight: 0.3)
  for (const transition of topicTransitions) {
    const timestamp = Math.round(transition.timestamp);
    addOrUpdateBoundary(boundaries, timestamp, { transcript: transition.confidence }, timeWindow);
  }

  // Calculate final scores
  return Array.from(boundaries.values())
    .map(b => ({
      ...b,
      score: (b.signals.audio * 0.4) + (b.signals.visual * 0.3) + (b.signals.transcript * 0.3)
    }))
    .filter(b => b.score > 0.6) // Threshold
    .sort((a, b) => a.timestamp - b.timestamp);
}
```

---

## Title Generation System

### Approach: AI-Powered Title Generation

**Strategy**: Use speech-to-text transcript + topic modeling to generate descriptive titles.

### 1. AssemblyAI Built-In Titles (Simplest)

```typescript
// AssemblyAI returns chapter titles automatically
const chapters = result.chapters.map(ch => ({
  start: ch.start / 1000, // ms to seconds
  end: ch.end / 1000,
  title: ch.headline, // Auto-generated
  summary: ch.summary, // Detailed summary
  confidence: ch.confidence
}));

// Example output:
// {
//   start: 0,
//   end: 300,
//   title: "Introduction to Tafsir Al-Baqarah",
//   summary: "The speaker introduces the session on Quranic exegesis...",
//   confidence: 0.89
// }
```

### 2. GPT-4 Custom Titles (For Bilingual Support)

```typescript
async function generateBilingualTitles(
  chapters: ChapterBoundary[],
  transcript: string
): Promise<ChapterWithTitles[]> {
  const prompt = `
You are an expert in Islamic education content. Given a transcript and chapter timestamps,
generate concise, descriptive chapter titles in both English and Arabic.

Guidelines:
- Titles should be 3-8 words
- Use Islamic terminology appropriately (Tafsir, Hadith, Seerah, Fiqh, etc.)
- Be specific about the topic covered
- Arabic titles should use formal Modern Standard Arabic
- Respect Islamic scholarly language conventions

Transcript:
${transcript}

Chapter timestamps:
${chapters.map((ch, i) => `Chapter ${i + 1}: ${formatTime(ch.timestamp)}`).join('\n')}

Return JSON array:
[
  {
    "start": 0,
    "end": 300,
    "titleEn": "Introduction to Surah Al-Baqarah",
    "titleAr": "مقدمة لسورة البقرة",
    "confidence": 0.9
  },
  ...
]
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3 // Lower temperature for consistency
  });

  return JSON.parse(response.choices[0].message.content);
}
```

### 3. Islamic Vocabulary Enhancement

**Custom Dictionary**:
```typescript
const ISLAMIC_TERMS = {
  // Quranic Sciences
  'tafsir': { en: 'Quranic Exegesis', ar: 'تفسير' },
  'tilawah': { en: 'Quranic Recitation', ar: 'تلاوة' },
  'tajweed': { en: 'Quranic Pronunciation', ar: 'تجويد' },

  // Hadith Sciences
  'hadith': { en: 'Prophetic Tradition', ar: 'حديث' },
  'sanad': { en: 'Chain of Narration', ar: 'سناد' },
  'isnad': { en: 'Narration Chain', ar: 'إسناد' },

  // Jurisprudence
  'fiqh': { en: 'Islamic Jurisprudence', ar: 'فقه' },
  'usul': { en: 'Principles of Jurisprudence', ar: 'أصول الفقه' },
  'fatwa': { en: 'Legal Ruling', ar: 'فتوى' },

  // Theology
  'aqeedah': { en: 'Islamic Creed', ar: 'عقيدة' },
  'tawheed': { en: 'Monotheism', ar: 'توحيد' },

  // History
  'seerah': { en: 'Prophetic Biography', ar: 'سيرة' },
  'khutbah': { en: 'Friday Sermon', ar: 'خطبة' }
};

function enhanceTitle(title: string, language: 'en' | 'ar'): string {
  // Replace generic terms with Islamic terminology
  for (const [key, values] of Object.entries(ISLAMIC_TERMS)) {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    title = title.replace(regex, values[language]);
  }

  return title;
}
```

### 4. Title Quality Validation

```typescript
interface TitleQuality {
  isValid: boolean;
  score: number;
  issues: string[];
}

function validateTitle(title: string): TitleQuality {
  const issues: string[] = [];
  let score = 1.0;

  // Check length
  const wordCount = title.split(/\s+/).length;
  if (wordCount < 3) {
    issues.push('Title too short');
    score -= 0.2;
  } else if (wordCount > 10) {
    issues.push('Title too long');
    score -= 0.1;
  }

  // Check for generic titles
  const genericPatterns = [
    /^chapter \d+$/i,
    /^part \d+$/i,
    /^section \d+$/i,
    /^segment \d+$/i
  ];

  if (genericPatterns.some(p => p.test(title))) {
    issues.push('Title is too generic');
    score -= 0.3;
  }

  // Check for meaningful content
  const meaningfulWords = title.match(/\b[A-Za-z\u0600-\u06FF]{4,}\b/g);
  if (!meaningfulWords || meaningfulWords.length < 2) {
    issues.push('Title lacks meaningful content');
    score -= 0.2;
  }

  return {
    isValid: score >= 0.6,
    score: Math.max(0, score),
    issues
  };
}
```

---

## Creator Review/Approval Workflow

### UI/UX Flow

```
1. Video Upload Complete
   ↓
2. Creator clicks "Generate Auto-Chapters" button
   ↓
3. Processing starts (background job)
   ↓
4. Progress indicator (0% → 100%)
   ↓
5. Review Screen appears with:
   - Timeline visualization
   - Chapter markers with titles
   - Confidence scores
   - Edit controls
   ↓
6. Creator actions:
   - Accept All
   - Reject All
   - Edit Individual Chapters
   - Merge Chapters
   - Split Chapters
   ↓
7. Save approved chapters
   ↓
8. Chapters published with video
```

### React Component Architecture

```typescript
// Main component: apps/web/src/components/AutoChapters/AutoChapterReview.tsx

interface AutoChapterReviewProps {
  videoId: string;
  videoDuration: number;
  videoUrl: string;
}

export function AutoChapterReview({
  videoId,
  videoDuration,
  videoUrl
}: AutoChapterReviewProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<'idle' | 'processing' | 'review' | 'saving'>('idle');
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<AIGeneratedChapter[]>([]);

  const handleGenerate = async () => {
    setStatus('processing');

    try {
      // Start AI processing
      const response = await fetch(`/api/videos/${videoId}/auto-chapters`, {
        method: 'POST'
      });

      const { jobId } = await response.json();

      // Poll for progress
      const interval = setInterval(async () => {
        const status = await fetch(`/api/jobs/${jobId}`);
        const data = await status.json();

        setProgress(data.progress);

        if (data.status === 'completed') {
          clearInterval(interval);
          setChapters(data.chapters);
          setStatus('review');
        } else if (data.status === 'failed') {
          clearInterval(interval);
          showError(data.error);
          setStatus('idle');
        }
      }, 2000);

    } catch (error) {
      showError('Failed to generate chapters');
      setStatus('idle');
    }
  };

  return (
    <div className="auto-chapter-review">
      {status === 'idle' && (
        <button onClick={handleGenerate}>
          {t('autoChapters.generate')}
        </button>
      )}

      {status === 'processing' && (
        <ProcessingIndicator progress={progress} />
      )}

      {status === 'review' && (
        <ChapterEditor
          chapters={chapters}
          videoUrl={videoUrl}
          videoDuration={videoDuration}
          onSave={handleSave}
          onCancel={() => setStatus('idle')}
        />
      )}
    </div>
  );
}
```

### Chapter Editor Component

```typescript
// apps/web/src/components/AutoChapters/ChapterEditor.tsx

export function ChapterEditor({
  chapters,
  videoUrl,
  videoDuration,
  onSave,
  onCancel
}: ChapterEditorProps) {
  const { t } = useLanguage();
  const [editedChapters, setEditedChapters] = useState(chapters);
  const playerRef = useRef<Player | null>(null);

  const handleEditTitle = (index: number, field: 'titleEn' | 'titleAr', value: string) => {
    setEditedChapters(prev => prev.map((ch, i) =>
      i === index ? { ...ch, [field]: value } : ch
    ));
  };

  const handleMergeChapters = (index1: number, index2: number) => {
    // Combine two adjacent chapters
    const merged = {
      ...editedChapters[index1],
      end: editedChapters[index2].end,
      titleEn: `${editedChapters[index1].titleEn} & ${editedChapters[index2].titleEn}`,
      titleAr: `${editedChapters[index1].titleAr} و ${editedChapters[index2].titleAr}`,
      confidence: Math.min(editedChapters[index1].confidence, editedChapters[index2].confidence)
    };

    setEditedChapters(prev => [
      ...prev.slice(0, index1),
      merged,
      ...prev.slice(index2 + 1)
    ]);
  };

  const handleSplitChapter = (index: number, splitTime: number) => {
    const original = editedChapters[index];
    const part1 = {
      ...original,
      end: splitTime,
      titleEn: `${original.titleEn} (Part 1)`,
      titleAr: `${original.titleAr} (الجزء الأول)`
    };
    const part2 = {
      ...original,
      start: splitTime,
      titleEn: `${original.titleEn} (Part 2)`,
      titleAr: `${original.titleAr} (الجزء الثاني)`,
      id: `${original.id}-split`
    };

    setEditedChapters(prev => [
      ...prev.slice(0, index),
      part1,
      part2,
      ...prev.slice(index + 1)
    ]);
  };

  const handleAcceptAll = () => {
    onSave(editedChapters);
  };

  const handleRejectAll = () => {
    if (confirm(t('autoChapters.confirmReject'))) {
      onCancel();
    }
  };

  return (
    <div className="chapter-editor">
      {/* Video Player with Timeline */}
      <div className="editor-player">
        <VideoPlayer
          ref={playerRef}
          src={videoUrl}
          chapters={editedChapters}
        />
        <ChapterTimeline
          chapters={editedChapters}
          duration={videoDuration}
          onChapterClick={(ch) => playerRef.current?.currentTime(ch.start)}
          onSplit={handleSplitChapter}
        />
      </div>

      {/* Chapter List Editor */}
      <div className="editor-list">
        <div className="editor-actions">
          <button onClick={handleAcceptAll} className="btn-primary">
            {t('autoChapters.acceptAll')}
          </button>
          <button onClick={handleRejectAll} className="btn-secondary">
            {t('autoChapters.rejectAll')}
          </button>
        </div>

        <div className="chapter-items">
          {editedChapters.map((chapter, index) => (
            <ChapterEditItem
              key={chapter.id}
              chapter={chapter}
              index={index}
              onEditTitle={(field, value) => handleEditTitle(index, field, value)}
              onMerge={() => index < editedChapters.length - 1 && handleMergeChapters(index, index + 1)}
              onDelete={() => handleDeleteChapter(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Chapter Edit Item Component

```typescript
// apps/web/src/components/AutoChapters/ChapterEditItem.tsx

export function ChapterEditItem({
  chapter,
  index,
  onEditTitle,
  onMerge,
  onDelete
}: ChapterEditItemProps) {
  const { t, isRTL } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className={`chapter-edit-item ${chapter.confidence < 0.7 ? 'low-confidence' : ''}`}>
      <div className="chapter-header">
        <span className="chapter-number">{index + 1}</span>
        <span className="chapter-time">
          {formatTime(chapter.start)} → {formatTime(chapter.end)}
        </span>
        <span className={`confidence-badge confidence-${getConfidenceLevel(chapter.confidence)}`}>
          {Math.round(chapter.confidence * 100)}%
        </span>
      </div>

      {isEditing ? (
        <div className="chapter-edit-form">
          <input
            type="text"
            value={chapter.titleEn}
            onChange={(e) => onEditTitle('titleEn', e.target.value)}
            placeholder={t('autoChapters.titleEnglish')}
          />
          <input
            type="text"
            value={chapter.titleAr}
            onChange={(e) => onEditTitle('titleAr', e.target.value)}
            placeholder={t('autoChapters.titleArabic')}
            dir="rtl"
          />
          <button onClick={() => setIsEditing(false)}>
            {t('common.save')}
          </button>
        </div>
      ) : (
        <div className="chapter-display">
          <p className="title-en">{chapter.titleEn}</p>
          <p className="title-ar" dir="rtl">{chapter.titleAr}</p>
        </div>
      )}

      <div className="chapter-actions">
        <button onClick={() => setIsEditing(!isEditing)} title={t('common.edit')}>
          <Edit2 size={16} />
        </button>
        <button onClick={onMerge} title={t('autoChapters.merge')}>
          <Merge size={16} />
        </button>
        <button onClick={onDelete} title={t('common.delete')} className="danger">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}
```

---

## Technical Architecture

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Web Frontend (React)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         Auto-Chapter Review UI                         │  │
│  │  - Generate button                                     │  │
│  │  - Progress indicator                                  │  │
│  │  - Chapter editor                                      │  │
│  │  - Timeline visualization                              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    API Layer (Hono)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  POST /api/videos/{id}/auto-chapters                  │  │
│  │  GET  /api/jobs/{jobId}                               │  │
│  │  PUT  /api/videos/{id}/chapters (save approved)       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│               Background Job Processor                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │        Cloudflare Queue Consumer                       │  │
│  │  1. Extract audio from video (FFmpeg)                 │  │
│  │  2. Send to AI service (AssemblyAI)                   │  │
│  │  3. Process chapter boundaries                        │  │
│  │  4. Generate bilingual titles (GPT-4 optional)        │  │
│  │  5. Store results in R2                               │  │
│  │  6. Update job status                                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              External AI Services                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   AssemblyAI    │  │  OpenAI GPT  │  │   Deepgram      │ │
│  │  (Primary)      │  │  (Bilingual) │  │  (Alternative)  │ │
│  │  - Transcribe   │  │  - Titles    │  │  - Transcribe   │ │
│  │  - Chapters     │  │  - Enhance   │  │  - Topics       │ │
│  └─────────────────┘  └──────────────┘  └─────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Storage (R2)                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  auto-chapters/                                        │  │
│  │  ├── {videoId}/metadata.json  (job status)            │  │
│  │  ├── {videoId}/raw.json       (AI raw response)       │  │
│  │  └── {videoId}/processed.json (processed chapters)    │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  videos/ (updated after approval)                     │  │
│  │  └── {videoId}.json  (chapters field)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Initiation**: Creator clicks "Generate Auto-Chapters"
2. **Queue Job**: API creates job and sends to Cloudflare Queue
3. **Processing**: Processor extracts audio → sends to AI → processes response
4. **Storage**: Results stored in R2 (`auto-chapters/{videoId}/`)
5. **Review**: Creator reviews AI-generated chapters in UI
6. **Approval**: Approved chapters saved to video metadata
7. **Cleanup**: Temporary processing data archived or deleted

---

## Implementation Details

### Backend Implementation

#### 1. API Endpoint: Generate Auto-Chapters

**File**: `apps/api-videos/src/endpoints/video/generateAutoChapters.ts`

```typescript
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { addAuthToSchema } from '@/lib/auth';

export class GenerateAutoChapters extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Video'],
    summary: 'Generate auto-chapters using AI',
    parameters: z.object({
      videoId: z.string().min(1),
    }),
    requestBody: z.object({
      service: z.enum(['assemblyai', 'deepgram', 'openai']).optional().default('assemblyai'),
      language: z.enum(['ar', 'en']).optional(),
      generateBilingual: z.boolean().optional().default(true),
    }),
    responses: {
      '202': {
        description: 'Processing started',
        schema: z.object({
          success: z.boolean(),
          jobId: z.string(),
          message: z.string(),
        }),
      },
      '404': { description: 'Video not found' },
      '403': { description: 'Not authorized' },
    },
  }, 'required');

  async handle(c: Context) {
    const { videoId } = c.req.param();
    const body = await c.req.json();
    const { user } = c.get('auth');
    const env = c.env as Env;

    // Fetch video
    const videoRepo = new R2Repository(env.R2_BUCKET, 'videos');
    const video = await videoRepo.get(videoId);

    if (!video) {
      return c.json({ success: false, message: 'Video not found' }, 404);
    }

    // Check ownership
    if (video.userId !== user.id) {
      return c.json({ success: false, message: 'Not authorized' }, 403);
    }

    // Validate video has audio
    if (!video.videoUrl) {
      return c.json({
        success: false,
        message: 'Video not yet processed'
      }, 400);
    }

    // Check if already processing
    const existingJob = await env.R2_BUCKET.get(`auto-chapters/${videoId}/metadata.json`);
    if (existingJob) {
      const metadata = await existingJob.json();
      if (metadata.status === 'processing') {
        return c.json({
          success: false,
          message: 'Auto-chapter generation already in progress',
          jobId: metadata.jobId
        }, 409);
      }
    }

    // Create job
    const jobId = uuidv4();
    const jobMetadata = {
      jobId,
      videoId,
      userId: user.id,
      service: body.service,
      language: body.language || video.language || 'ar',
      generateBilingual: body.generateBilingual,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    // Store job metadata
    await env.R2_BUCKET.put(
      `auto-chapters/${videoId}/metadata.json`,
      JSON.stringify(jobMetadata)
    );

    // Queue processing job
    await env.QUEUE.send({
      type: 'AUTO_CHAPTERS_GENERATE',
      data: {
        jobId,
        videoId,
        videoUrl: video.videoUrl,
        duration: video.duration,
        service: body.service,
        language: jobMetadata.language,
        generateBilingual: body.generateBilingual,
      }
    });

    logger.info('Auto-chapter generation queued', { jobId, videoId });

    return c.json({
      success: true,
      jobId,
      message: 'Auto-chapter generation started',
    }, 202);
  }
}
```

#### 2. Job Status Endpoint

**File**: `apps/api-videos/src/endpoints/jobs/status.ts`

```typescript
export class JobStatus extends OpenAPIRoute {
  schema = {
    tags: ['Jobs'],
    summary: 'Get job status',
    parameters: z.object({
      jobId: z.string().uuid(),
    }),
    responses: {
      '200': {
        description: 'Job status',
        schema: z.object({
          success: z.boolean(),
          status: z.enum(['queued', 'processing', 'completed', 'failed']),
          progress: z.number().min(0).max(100),
          result: z.any().optional(),
          error: z.string().optional(),
        }),
      },
    },
  };

  async handle(c: Context) {
    const { jobId } = c.req.param();
    const env = c.env as Env;

    // Find job by scanning auto-chapters directory
    const jobs = await env.R2_BUCKET.list({ prefix: 'auto-chapters/' });

    for (const obj of jobs.objects) {
      if (obj.key.includes('metadata.json')) {
        const data = await env.R2_BUCKET.get(obj.key);
        const metadata = await data.json();

        if (metadata.jobId === jobId) {
          // Check if completed
          if (metadata.status === 'completed') {
            const result = await env.R2_BUCKET.get(
              obj.key.replace('metadata.json', 'processed.json')
            );

            return c.json({
              success: true,
              status: metadata.status,
              progress: 100,
              result: await result.json(),
            });
          }

          return c.json({
            success: true,
            status: metadata.status,
            progress: metadata.progress || 0,
            error: metadata.error,
          });
        }
      }
    }

    return c.json({ success: false, message: 'Job not found' }, 404);
  }
}
```

#### 3. Queue Processor

**File**: `apps/processor/src/handlers/autoChapters.ts`

```typescript
import { AssemblyAI } from 'assemblyai';
import OpenAI from 'openai';

interface AutoChaptersJob {
  jobId: string;
  videoId: string;
  videoUrl: string;
  duration: number;
  service: 'assemblyai' | 'deepgram' | 'openai';
  language: string;
  generateBilingual: boolean;
}

export async function processAutoChaptersJob(
  job: AutoChaptersJob,
  env: Env
) {
  const logger = env.logger;

  try {
    // Update status
    await updateJobStatus(env, job.videoId, {
      status: 'processing',
      progress: 10,
    });

    logger.info('Starting auto-chapter generation', { jobId: job.jobId });

    // Step 1: Extract audio URL (Bunny.net provides audio stream)
    const audioUrl = job.videoUrl.replace('/playlist.m3u8', '/audio.mp3');

    await updateJobStatus(env, job.videoId, { progress: 20 });

    // Step 2: Process with AI service
    let chapters: AIGeneratedChapter[];

    if (job.service === 'assemblyai') {
      chapters = await processWithAssemblyAI(audioUrl, job.language, env);
    } else if (job.service === 'openai') {
      chapters = await processWithOpenAI(audioUrl, job.language, env);
    } else {
      throw new Error(`Unsupported service: ${job.service}`);
    }

    await updateJobStatus(env, job.videoId, { progress: 70 });

    // Step 3: Generate bilingual titles if requested
    if (job.generateBilingual && chapters.length > 0) {
      chapters = await generateBilingualTitles(chapters, job.language, env);
    }

    await updateJobStatus(env, job.videoId, { progress: 90 });

    // Step 4: Post-process and validate
    chapters = validateAndCleanChapters(chapters, job.duration);

    // Step 5: Store results
    await env.R2_BUCKET.put(
      `auto-chapters/${job.videoId}/processed.json`,
      JSON.stringify(chapters)
    );

    await updateJobStatus(env, job.videoId, {
      status: 'completed',
      progress: 100,
    });

    logger.info('Auto-chapter generation completed', {
      jobId: job.jobId,
      chapterCount: chapters.length,
    });

  } catch (error) {
    logger.error('Auto-chapter generation failed', { error, jobId: job.jobId });

    await updateJobStatus(env, job.videoId, {
      status: 'failed',
      error: error.message,
    });
  }
}

async function processWithAssemblyAI(
  audioUrl: string,
  language: string,
  env: Env
): Promise<AIGeneratedChapter[]> {
  const client = new AssemblyAI({ apiKey: env.ASSEMBLYAI_KEY });

  const transcript = await client.transcripts.create({
    audio_url: audioUrl,
    auto_chapters: true,
    language_code: language === 'ar' ? 'ar' : 'en',
    speaker_labels: true,
  });

  const result = await client.transcripts.waitUntilReady(transcript.id);

  if (!result.chapters) {
    throw new Error('No chapters generated');
  }

  return result.chapters.map((ch, i) => ({
    id: `chapter-${i}`,
    start: ch.start / 1000, // ms to seconds
    end: ch.end / 1000,
    titleEn: ch.headline,
    titleAr: '', // Will be filled by bilingual generation
    confidence: 0.85, // AssemblyAI doesn't provide confidence
    summary: ch.summary,
  }));
}

async function generateBilingualTitles(
  chapters: AIGeneratedChapter[],
  primaryLanguage: string,
  env: Env
): Promise<AIGeneratedChapter[]> {
  const openai = new OpenAI({ apiKey: env.OPENAI_KEY });

  const prompt = `
Given the following chapter titles in ${primaryLanguage === 'ar' ? 'Arabic' : 'English'},
generate concise titles in both English and Arabic. Use proper Islamic terminology.

Chapters:
${chapters.map((ch, i) => `${i + 1}. ${ch.titleEn || ch.titleAr}`).join('\n')}

Return JSON array with titleEn and titleAr for each chapter.
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const titles = JSON.parse(response.choices[0].message.content);

  return chapters.map((ch, i) => ({
    ...ch,
    titleEn: titles.chapters[i].titleEn,
    titleAr: titles.chapters[i].titleAr,
  }));
}

function validateAndCleanChapters(
  chapters: AIGeneratedChapter[],
  videoDuration: number
): AIGeneratedChapter[] {
  // Remove invalid chapters
  let valid = chapters.filter(ch => {
    if (ch.end - ch.start < 10) return false; // Too short
    if (ch.start < 0 || ch.end > videoDuration) return false; // Out of bounds
    return true;
  });

  // Ensure first chapter starts at 0
  if (valid.length > 0 && valid[0].start > 0) {
    valid[0].start = 0;
  }

  // Fix gaps between chapters
  for (let i = 0; i < valid.length - 1; i++) {
    if (valid[i].end !== valid[i + 1].start) {
      valid[i].end = valid[i + 1].start;
    }
  }

  // Ensure last chapter ends at video duration
  if (valid.length > 0) {
    valid[valid.length - 1].end = videoDuration;
  }

  return valid;
}

async function updateJobStatus(
  env: Env,
  videoId: string,
  update: Partial<JobMetadata>
) {
  const key = `auto-chapters/${videoId}/metadata.json`;
  const existing = await env.R2_BUCKET.get(key);
  const metadata = existing ? await existing.json() : {};

  await env.R2_BUCKET.put(
    key,
    JSON.stringify({
      ...metadata,
      ...update,
      updatedAt: new Date().toISOString(),
    })
  );
}
```

---

## Files to Create/Modify

### New Files to Create

**API Layer**:
```
apps/api-videos/src/
├── endpoints/
│   └── video/
│       ├── generateAutoChapters.ts    # POST /api/videos/{id}/auto-chapters
│       └── jobs/
│           └── status.ts              # GET /api/jobs/{jobId}
└── lib/
    └── ai/
        ├── assemblyai.ts              # AssemblyAI client wrapper
        ├── openai.ts                  # OpenAI client wrapper
        └── deepgram.ts                # Deepgram client wrapper (optional)
```

**Processor**:
```
apps/processor/src/
├── handlers/
│   └── autoChapters.ts                # Queue processor for AI jobs
└── lib/
    └── audio/
        └── extractor.ts               # FFmpeg audio extraction
```

**Frontend**:
```
apps/web/src/
├── components/
│   └── AutoChapters/
│       ├── AutoChapterReview.tsx      # Main review component
│       ├── ChapterEditor.tsx          # Chapter editing interface
│       ├── ChapterEditItem.tsx        # Individual chapter editor
│       ├── ChapterTimeline.tsx        # Visual timeline
│       ├── ProcessingIndicator.tsx    # Progress indicator
│       └── ConfidenceBadge.tsx        # Confidence score display
├── hooks/
│   └── useAutoChapters.ts             # Auto-chapter state management
└── lib/
    └── api/
        └── autoChapters.ts            # API client functions
```

### Files to Modify

**Shared Types**:
- `packages/shared-types/src/video.ts` - Add AIGeneratedChapter interface

**API Configuration**:
- `apps/api-videos/wrangler.jsonc` - Add AI service secrets
- `apps/api-videos/src/index.ts` - Register auto-chapter endpoints

**Processor Configuration**:
- `apps/processor/wrangler.toml` - Add AI service secrets
- `apps/processor/src/index.ts` - Register auto-chapter handler

**Video Management**:
- `apps/web/src/app/[locale]/upload/page.tsx` - Add "Generate Auto-Chapters" option
- `apps/web/src/app/[locale]/videos/[id]/edit/page.tsx` - Add auto-chapter UI

---

## Testing Strategy

### Unit Tests

**Parser Tests**:
```typescript
describe('Auto-Chapter Detection', () => {
  test('should detect silence-based boundaries', async () => {
    const audio = loadTestAudio('lecture-with-pauses.mp3');
    const silences = await detectSilence(audio);

    expect(silences).toHaveLength(5);
    expect(silences[0].duration).toBeGreaterThan(2);
  });

  test('should combine multi-modal signals', () => {
    const boundaries = combineSignals(
      [{ start: 0, end: 120, duration: 3 }], // silence
      [{ timestamp: 118, confidence: 0.8, type: 'cut' }], // scene change
      [{ timestamp: 119, confidence: 0.7 }] // topic transition
    );

    expect(boundaries[0].score).toBeGreaterThan(0.6);
  });
});
```

**Title Generation Tests**:
```typescript
describe('Title Generation', () => {
  test('should generate bilingual titles', async () => {
    const chapters = await generateBilingualTitles([
      { start: 0, end: 300, titleEn: 'Introduction' }
    ], 'en', mockEnv);

    expect(chapters[0].titleAr).toMatch(/مقدمة/);
  });

  test('should use Islamic terminology', () => {
    const enhanced = enhanceTitle('Quran explanation', 'en');
    expect(enhanced).toContain('Tafsir');
  });
});
```

### Integration Tests

**API Endpoints**:
```typescript
describe('Auto-Chapters API', () => {
  test('POST /api/videos/:id/auto-chapters', async () => {
    const response = await request(app)
      .post('/api/videos/test-video/auto-chapters')
      .set('Authorization', `Bearer ${token}`)
      .send({ service: 'assemblyai' });

    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
  });

  test('GET /api/jobs/:jobId', async () => {
    const response = await request(app)
      .get(`/api/jobs/${jobId}`);

    expect(response.body.status).toMatch(/queued|processing|completed/);
  });
});
```

### E2E Tests

**Creator Workflow**:
```typescript
describe('Auto-Chapter Workflow', () => {
  test('should generate and approve chapters', async ({ page }) => {
    await page.goto('/videos/test-video/edit');

    // Click generate button
    await page.click('button:has-text("Generate Auto-Chapters")');

    // Wait for processing
    await page.waitForSelector('.chapter-editor', { timeout: 120000 });

    // Verify chapters loaded
    const chapters = await page.$$('.chapter-edit-item');
    expect(chapters.length).toBeGreaterThan(0);

    // Edit a title
    await page.click('.chapter-edit-item:first-child button[title="Edit"]');
    await page.fill('input[placeholder*="English"]', 'Updated Title');
    await page.click('button:has-text("Save")');

    // Accept all
    await page.click('button:has-text("Accept All")');

    // Verify saved
    await expect(page.locator('.success-message')).toBeVisible();
  });
});
```

---

## Cost Analysis

### Processing Cost Breakdown

**Assumptions**:
- Average video length: 30 minutes
- 1,000 videos processed per month
- Using AssemblyAI (recommended)

#### AssemblyAI Pricing

| Component | Cost per Minute | 30-Min Video | 1,000 Videos/Month |
|-----------|----------------|--------------|---------------------|
| Transcription | $0.015 | $0.45 | $450 |
| Auto Chapters | $0.0025 | $0.075 | $75 |
| **Total** | **$0.0175** | **$0.525** | **$525** |

#### Optional: GPT-4 for Bilingual Titles

| Component | Cost | 30-Min Video | 1,000 Videos/Month |
|-----------|------|--------------|---------------------|
| Input tokens (5K avg) | $0.05 | $0.05 | $50 |
| Output tokens (2K avg) | $0.06 | $0.06 | $60 |
| **Total** | **$0.11** | **$0.11** | **$110** |

#### Total Monthly Cost Estimates

| Scenario | Per Video | 1,000 Videos | 10,000 Videos |
|----------|-----------|--------------|----------------|
| AssemblyAI only | $0.53 | $530 | $5,300 |
| + GPT-4 bilingual | $0.64 | $640 | $6,400 |
| **With free tier** | $0.53 | **$505** | $5,300 |

**Notes**:
- AssemblyAI offers 5 hours free per month (~$5 credit)
- Cost scales linearly with video length
- Opt-in feature reduces costs (only process when requested)

### Cost Optimization Strategies

1. **Caching**:
   - Cache AI responses for 90 days
   - Don't re-process if creator re-requests
   - Estimated savings: 20-30%

2. **Batch Processing**:
   - Process multiple videos in same API call
   - Negotiate volume discounts
   - Estimated savings: 10-15%

3. **Selective Processing**:
   - Only process videos > 10 minutes
   - Skip videos with manual chapters
   - Estimated savings: 40-50%

4. **Free Tier Maximization**:
   - Rotate API keys across team members
   - Use free tier for development/testing
   - Estimated savings: $60/month

### ROI Analysis

**Value Proposition**:
- Creator time saved: 15 minutes per video (manual chapter creation)
- Labor cost saved: $15/hour × 0.25 hours = $3.75 per video
- ROI: $3.75 saved vs $0.53 cost = **86% cost savings**

**Break-even**: Even at 1,000 videos/month, the feature pays for itself if it saves 7 minutes of manual work per video.

---

## Migration Plan

### Phase 1: Infrastructure Setup (Week 1)

**Day 1-2**: External Service Setup
- [ ] Create AssemblyAI account
- [ ] Configure API keys in secrets
- [ ] Test API connectivity
- [ ] Set up billing alerts

**Day 3-4**: Backend Scaffolding
- [ ] Create R2 bucket for auto-chapters
- [ ] Implement job queueing system
- [ ] Add job status tracking
- [ ] Create basic processor handler

**Day 5**: Testing
- [ ] Unit tests for job queue
- [ ] Integration tests for AI API
- [ ] Load testing (1-100 concurrent jobs)

### Phase 2: AI Integration (Week 2)

**Day 1-2**: AssemblyAI Integration
- [ ] Implement transcription API calls
- [ ] Parse auto-chapter responses
- [ ] Handle errors and retries
- [ ] Add progress tracking

**Day 3-4**: Title Enhancement
- [ ] GPT-4 bilingual title generation
- [ ] Islamic vocabulary enhancement
- [ ] Title quality validation
- [ ] Fallback to English-only

**Day 5**: Testing
- [ ] Test with Arabic lectures
- [ ] Test with English sermons
- [ ] Test edge cases (very short/long videos)

### Phase 3: Frontend Development (Week 3)

**Day 1-2**: Review UI
- [ ] Auto-chapter review component
- [ ] Chapter editor interface
- [ ] Timeline visualization
- [ ] Progress indicator

**Day 3-4**: Editing Features
- [ ] Chapter title editing
- [ ] Merge/split operations
- [ ] Bulk accept/reject
- [ ] Confidence score display

**Day 5**: Testing
- [ ] Component unit tests
- [ ] E2E workflow tests
- [ ] Accessibility testing

### Phase 4: Polish & Launch (Week 4)

**Day 1-2**: Integration
- [ ] Connect frontend to backend
- [ ] Error handling
- [ ] Loading states
- [ ] Analytics tracking

**Day 3**: Performance
- [ ] Optimize API calls
- [ ] Cache AI responses
- [ ] Lazy load components

**Day 4**: Documentation
- [ ] User guide
- [ ] API documentation
- [ ] Cost tracking dashboard

**Day 5**: Production Deployment
- [ ] Deploy to staging
- [ ] Beta testing with 10 creators
- [ ] Fix critical bugs
- [ ] Deploy to production

---

## Success Metrics

### Usage Metrics

**Target after 3 months**:
- 25% of creators use auto-chapters
- 50% of auto-generated chapters approved without edits
- Average 5 chapters per video

### Quality Metrics

**Chapter Accuracy**:
- Boundary accuracy: > 85% (within 5 seconds of ideal)
- Title relevance: > 75% (creator approval rate)
- Low-confidence detections: < 15%

### Performance Metrics

**Processing Speed**:
- 10-minute video: < 2 minutes
- 30-minute video: < 5 minutes
- 60-minute video: < 10 minutes
- Job success rate: > 95%

### Cost Metrics

**Monthly Budget**:
- Total AI costs: < $1,000/month
- Cost per processed minute: < $0.02
- ROI: > 80% (vs manual chapter creation)

### Business Metrics

**Creator Satisfaction**:
- Feature satisfaction: > 4.0/5.0
- Time savings: 10-15 minutes per video
- Adoption rate: 25% within 6 months

---

## Conclusion

Auto-Chapters (AI Detection) is a **low-priority convenience feature** that builds on top of manual chapters (#4). While YouTube has this feature, it's not critical for Al Ummah Now's launch.

**Recommendation**: Implement manual chapters first (#4), then add AI auto-generation in Phase 2 or 3 based on creator demand.

**Key Advantages**:
- Saves creator time (15 min → 2 min per video)
- Improves content navigability
- Supports bilingual titles (English + Arabic)
- Cost-effective at scale ($0.53 per video)

**Key Risks**:
- External API dependency
- AI accuracy limitations (especially for Arabic)
- Ongoing costs for processing
- Creator trust in AI-generated content

**Next Steps**:
1. Wait for manual chapters (#4) to be implemented
2. Gather creator feedback on chapter creation workflow
3. Assess demand for auto-generation
4. Pilot with AssemblyAI on 100 videos
5. Evaluate accuracy and cost before full rollout

---

**Document Maintained By**: Architecture Team
**Review Schedule**: Quarterly (low priority)
**Dependencies**: Feature #4 (Manual Chapters), Bunny.net video URLs, R2 storage
**External Services**: AssemblyAI (primary), OpenAI GPT-4 (optional)
