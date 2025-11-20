# Age Restriction Option - Implementation Plan

**Feature ID**: 15
**Priority**: MEDIUM
**Complexity**: Simple (1-2 days)
**Document Version**: 1.0
**Created**: 2025-01-20
**Author**: System Architect

---

## Executive Summary

This document outlines the implementation plan for adding an Age Restriction Option to Al Ummah Now videos. This feature allows content creators to mark videos as 18+ restricted content, requiring viewers to be signed in and verify their age before viewing. This is particularly important for Islamic content that may contain mature topics such as war footage, graphic historical content, or sensitive fiqh discussions.

## Feature Requirements

### Core Requirements (from YouTube comparison)
- ✅ 18+ age restriction option during upload
- ✅ Age gate overlay before video plays
- ✅ Requires sign-in to watch restricted content
- ✅ Age verification through birth date in user profile
- ✅ Limited distribution (not shown in public feeds to non-authenticated users)
- ✅ Cannot be embedded on external sites when restricted
- ✅ Visual indicator (18+ badge) on thumbnails

### Additional Platform-Specific Requirements
- ✅ Bilingual age gate messages (English/Arabic)
- ✅ RTL support for Arabic age gate UI
- ✅ Respect Islamic content guidelines
- ✅ Audit logging for age verification attempts
- ✅ Parental controls integration (future phase)

## Use Cases for Islamic Content

### Primary Use Cases

1. **War and Conflict Coverage**
   - Palestine/Syria/Yemen graphic footage
   - Historical battle reenactments
   - Martyrdom documentation
   - Requires mature understanding of context

2. **Sensitive Fiqh Topics**
   - Marriage and intimacy rulings
   - Medical jurisprudence with graphic content
   - Criminal law (hudud) discussions
   - Women's health topics

3. **Historical Content**
   - Graphic descriptions of battles
   - Persecution and torture accounts
   - Colonial violence documentation
   - Holocaust/genocide education

4. **Medical and Health Content**
   - Surgery procedures
   - Childbirth education
   - Health condition discussions
   - Anatomy for educational purposes

5. **Current Events and News**
   - Graphic news footage
   - Natural disaster coverage
   - Crime and justice reporting
   - Political violence documentation

## Technical Architecture

### Data Model Changes

#### 1. Video Model Extension
```typescript
// packages/shared-types/src/video.ts

export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Age restriction fields
  ageRestricted?: boolean;           // Is this video age-restricted (18+)?
  ageRestrictionReason?: string;     // Optional reason for restriction
  ageVerificationRequired?: boolean; // Computed: true if ageRestricted
}

export interface VideoCreateRequest {
  // ... existing fields ...
  ageRestricted?: boolean;
  ageRestrictionReason?: string;
}

export interface VideoUpdateRequest {
  // ... existing fields ...
  ageRestricted?: boolean;
  ageRestrictionReason?: string;
}

export interface VideoUploadMetadata {
  // ... existing fields ...
  ageRestricted?: boolean;
  ageRestrictionReason?: string;
}
```

#### 2. User Profile Extension
```typescript
// packages/shared-types/src/user.ts

export interface Profile extends Timestamps {
  // ... existing fields ...

  // Age verification fields
  dateOfBirth?: string;        // ISO date string (YYYY-MM-DD)
  ageVerified?: boolean;       // Has user verified they are 18+?
  ageVerifiedAt?: string;      // Timestamp of verification
  parentalControlsEnabled?: boolean; // Future: parental controls
}

export interface ProfileUpdateRequest {
  // ... existing fields ...
  dateOfBirth?: string;
}

// Age verification result type
export interface AgeVerificationResult {
  isVerified: boolean;
  isAdult: boolean;  // 18+ based on dateOfBirth
  age?: number;      // Calculated age (not stored)
  requiresVerification: boolean;
  message?: string;
}
```

### API Endpoint Modifications

#### 1. Video Upload/Update Endpoints
```typescript
// apps/api-videos/src/endpoints/video/uploadInitiate.ts
// Add ageRestricted to schema validation

const bodySchema = z.object({
  // ... existing fields ...
  ageRestricted: z.boolean().optional(),
  ageRestrictionReason: z.string().max(500).optional(),
});

// Validate age restriction reason if restricted
if (body.ageRestricted && !body.ageRestrictionReason) {
  return c.json({
    success: false,
    error: "Age restriction reason is required when restricting content"
  }, 400);
}
```

#### 2. Video Fetch Endpoint - Age Gate Check
```typescript
// apps/api-videos/src/endpoints/video/videoFetch.ts

export class VideoFetch extends OpenAPIRoute {
  async handle(c: Context) {
    const videoId = c.req.param('id');
    const auth = c.get('auth');

    // Fetch video
    const video = await videoRepo.getObject(videoId);

    // Check age restriction
    if (video.ageRestricted) {
      // If not authenticated, return restricted response
      if (!auth?.userId) {
        return c.json({
          success: false,
          error: "age_restricted",
          requiresAuth: true,
          video: {
            id: video.id,
            title: video.title,
            ageRestricted: true,
            thumbnailUrl: video.thumbnailUrl
          }
        }, 403);
      }

      // Check user's age verification
      const profile = await profileRepo.getObject(auth.userId);
      const ageVerification = verifyUserAge(profile);

      if (!ageVerification.isAdult) {
        return c.json({
          success: false,
          error: "age_verification_required",
          requiresAgeVerification: true,
          minimumAge: 18
        }, 403);
      }
    }

    // Return full video details
    return c.json({ success: true, data: video });
  }
}
```

#### 3. New Age Verification Endpoint
```typescript
// apps/api-videos/src/endpoints/profile/ageVerify.ts

export class AgeVerify extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Profile"],
    summary: "Verify user age for restricted content",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              confirmAge18Plus: z.boolean()
            })
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Age verification successful",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              isVerified: z.boolean(),
              isAdult: z.boolean()
            })
          }
        }
      }
    }
  }, 'required');

  async handle(c: Context) {
    const auth = c.get('auth');
    const { dateOfBirth, confirmAge18Plus } = await c.req.json();

    // Calculate age
    const age = calculateAge(dateOfBirth);
    const isAdult = age >= 18;

    // Update profile
    await profileRepo.updateObject(auth.userId, {
      dateOfBirth,
      ageVerified: isAdult && confirmAge18Plus,
      ageVerifiedAt: new Date().toISOString()
    });

    // Log verification attempt
    await queueEvent(c.env.queue, {
      type: 'age_verification',
      userId: auth.userId,
      dateOfBirth,
      age,
      isAdult,
      timestamp: new Date().toISOString()
    });

    return c.json({
      success: true,
      isVerified: true,
      isAdult
    });
  }
}
```

### Frontend Components

#### 1. Age Gate Overlay Component
```typescript
// apps/web/src/components/VideoPlayer/AgeGate.tsx

interface AgeGateProps {
  video: VideoObject;
  onVerify: () => void;
  onCancel: () => void;
  locale: 'en' | 'ar';
  isRTL: boolean;
}

export function AgeGate({ video, onVerify, onCancel, locale, isRTL }: AgeGateProps) {
  const { t } = useLanguage();

  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className={`bg-white dark:bg-gray-800 rounded-lg p-8 max-w-md mx-4 ${isRTL ? 'rtl' : 'ltr'}`}>
        {/* Warning Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
            <span className="text-4xl">🔞</span>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-center mb-4">
          {t('age_gate.title')}
        </h2>

        {/* Message */}
        <p className="text-gray-600 dark:text-gray-300 text-center mb-4">
          {t('age_gate.message')}
        </p>

        {/* Restriction Reason */}
        {video.ageRestrictionReason && (
          <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-4">
            <p className="text-sm">
              <strong>{t('age_gate.reason')}:</strong> {video.ageRestrictionReason}
            </p>
          </div>
        )}

        {/* Warning Text */}
        <div className="border-l-4 border-red-500 pl-4 mb-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('age_gate.warning')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onVerify}
            className="flex-1 bg-red-600 text-white py-3 px-4 rounded hover:bg-red-700"
          >
            {t('age_gate.verify_age')}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-200 dark:bg-gray-700 py-3 px-4 rounded hover:bg-gray-300"
          >
            {t('age_gate.go_back')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

#### 2. Age Verification Form Component
```typescript
// apps/web/src/components/Profile/AgeVerificationForm.tsx

export function AgeVerificationForm({ onComplete }: { onComplete: () => void }) {
  const { t, locale, isRTL } = useLanguage();
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [confirmAge, setConfirmAge] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/profile/age-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          dateOfBirth,
          confirmAge18Plus: confirmAge
        })
      });

      const result = await response.json();

      if (result.isAdult) {
        toast.success(t('age_verification.success'));
        onComplete();
      } else {
        toast.error(t('age_verification.not_old_enough'));
      }
    } catch (error) {
      toast.error(t('age_verification.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={isRTL ? 'rtl' : 'ltr'}>
      <div className="space-y-4">
        {/* Date of Birth Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t('age_verification.date_of_birth')}
          </label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            required
            className="w-full p-2 border rounded"
          />
        </div>

        {/* Age Confirmation Checkbox */}
        <div className="flex items-start">
          <input
            type="checkbox"
            id="confirm-age"
            checked={confirmAge}
            onChange={(e) => setConfirmAge(e.target.checked)}
            required
            className="mt-1"
          />
          <label htmlFor="confirm-age" className="ml-2 text-sm">
            {t('age_verification.confirm_18_plus')}
          </label>
        </div>

        {/* Privacy Notice */}
        <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 p-3 rounded">
          {t('age_verification.privacy_notice')}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !confirmAge}
          className="w-full bg-primary text-white py-2 px-4 rounded disabled:opacity-50"
        >
          {isSubmitting ? t('common.loading') : t('age_verification.verify_button')}
        </button>
      </div>
    </form>
  );
}
```

#### 3. Upload Form Age Restriction Checkbox
```typescript
// apps/web/src/components/videoUpload/index.tsx
// Add to existing upload form

const [ageRestricted, setAgeRestricted] = useState(false);
const [ageRestrictionReason, setAgeRestrictionReason] = useState('');

// In the form JSX:
<div className="border-t pt-4 mt-4">
  <h3 className="font-semibold mb-3">{t('upload.age_restriction')}</h3>

  <div className="space-y-3">
    <label className="flex items-start cursor-pointer">
      <input
        type="checkbox"
        checked={ageRestricted}
        onChange={(e) => setAgeRestricted(e.target.checked)}
        className="mt-1 mr-3"
      />
      <div>
        <span className="font-medium">{t('upload.restrict_to_18_plus')}</span>
        <p className="text-sm text-gray-500 mt-1">
          {t('upload.age_restriction_description')}
        </p>
      </div>
    </label>

    {ageRestricted && (
      <div className="ml-7">
        <label className="block text-sm font-medium mb-1">
          {t('upload.restriction_reason')}
        </label>
        <select
          value={ageRestrictionReason}
          onChange={(e) => setAgeRestrictionReason(e.target.value)}
          required={ageRestricted}
          className="w-full p-2 border rounded"
        >
          <option value="">{t('upload.select_reason')}</option>
          <option value="graphic_violence">{t('upload.reason_graphic_violence')}</option>
          <option value="war_footage">{t('upload.reason_war_footage')}</option>
          <option value="mature_topics">{t('upload.reason_mature_topics')}</option>
          <option value="medical_content">{t('upload.reason_medical_content')}</option>
          <option value="sensitive_fiqh">{t('upload.reason_sensitive_fiqh')}</option>
          <option value="other">{t('upload.reason_other')}</option>
        </select>

        <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm">
          <strong>{t('upload.warning')}:</strong> {t('upload.age_restriction_warning')}
        </div>
      </div>
    )}
  </div>
</div>
```

#### 4. Video Thumbnail Badge Component
```typescript
// apps/web/src/components/Video/AgeBadge.tsx

export function AgeBadge({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-bold ${className}`}>
      18+
    </div>
  );
}

// Usage in VideoCard component:
{video.ageRestricted && <AgeBadge />}
```

### Middleware and Access Control

#### 1. Video Access Middleware
```typescript
// apps/api-videos/src/middleware/age-verification.ts

export async function checkAgeRestriction(
  video: VideoObject,
  auth: AuthContext | null,
  profileRepo: R2Repository<Profile>
): Promise<{ allowed: boolean; reason?: string }> {
  // If video is not age restricted, allow access
  if (!video.ageRestricted) {
    return { allowed: true };
  }

  // If user is not authenticated, deny access
  if (!auth?.userId) {
    return {
      allowed: false,
      reason: 'authentication_required'
    };
  }

  // Fetch user profile and check age
  const profile = await profileRepo.getObject(auth.userId);

  if (!profile?.dateOfBirth) {
    return {
      allowed: false,
      reason: 'age_verification_required'
    };
  }

  const age = calculateAge(profile.dateOfBirth);
  if (age < 18) {
    return {
      allowed: false,
      reason: 'age_requirement_not_met'
    };
  }

  return { allowed: true };
}

// Helper function
function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}
```

#### 2. Embed Restriction Logic
```typescript
// apps/api-videos/src/endpoints/video/videoEmbed.ts

export class VideoEmbed extends OpenAPIRoute {
  async handle(c: Context) {
    const videoId = c.req.param('id');
    const video = await videoRepo.getObject(videoId);

    // Block embedding of age-restricted videos
    if (video.ageRestricted) {
      return c.json({
        success: false,
        error: "This video cannot be embedded due to age restrictions"
      }, 403);
    }

    // Return embed code for non-restricted videos
    return c.json({
      success: true,
      embedCode: generateEmbedCode(video)
    });
  }
}
```

### Internationalization (i18n)

#### English Translations
```json
// apps/web/public/locales/en/common.json
{
  "age_gate": {
    "title": "Age-Restricted Content",
    "message": "This video contains content that may not be suitable for all audiences.",
    "reason": "Restriction Reason",
    "warning": "You must be 18 or older to view this content. By continuing, you confirm that you meet the age requirement.",
    "verify_age": "I am 18 or older",
    "go_back": "Go Back"
  },
  "age_verification": {
    "title": "Age Verification Required",
    "date_of_birth": "Date of Birth",
    "confirm_18_plus": "I confirm that I am 18 years or older",
    "privacy_notice": "Your date of birth will be stored securely and used only for age verification purposes.",
    "verify_button": "Verify Age",
    "success": "Age verification successful",
    "not_old_enough": "You must be 18 or older to view this content",
    "error": "Age verification failed. Please try again."
  },
  "upload": {
    "age_restriction": "Age Restriction",
    "restrict_to_18_plus": "Restrict to viewers 18 and older",
    "age_restriction_description": "Enable this if your video contains mature content not suitable for minors",
    "restriction_reason": "Reason for restriction",
    "select_reason": "Select a reason",
    "reason_graphic_violence": "Graphic violence or disturbing imagery",
    "reason_war_footage": "War or conflict footage",
    "reason_mature_topics": "Mature or sensitive topics",
    "reason_medical_content": "Medical procedures or health content",
    "reason_sensitive_fiqh": "Sensitive Islamic jurisprudence topics",
    "reason_other": "Other mature content",
    "warning": "Warning",
    "age_restriction_warning": "Age-restricted videos have limited distribution and require viewers to sign in"
  }
}
```

#### Arabic Translations
```json
// apps/web/public/locales/ar/common.json
{
  "age_gate": {
    "title": "محتوى مقيد بالعمر",
    "message": "يحتوي هذا الفيديو على محتوى قد لا يكون مناسباً لجميع الجماهير.",
    "reason": "سبب التقييد",
    "warning": "يجب أن يكون عمرك 18 عامًا أو أكثر لمشاهدة هذا المحتوى. بالمتابعة، تؤكد أنك تستوفي شرط العمر.",
    "verify_age": "عمري 18 عامًا أو أكثر",
    "go_back": "رجوع"
  },
  "age_verification": {
    "title": "التحقق من العمر مطلوب",
    "date_of_birth": "تاريخ الميلاد",
    "confirm_18_plus": "أؤكد أن عمري 18 عامًا أو أكثر",
    "privacy_notice": "سيتم تخزين تاريخ ميلادك بشكل آمن واستخدامه فقط لأغراض التحقق من العمر.",
    "verify_button": "التحقق من العمر",
    "success": "تم التحقق من العمر بنجاح",
    "not_old_enough": "يجب أن يكون عمرك 18 عامًا أو أكثر لمشاهدة هذا المحتوى",
    "error": "فشل التحقق من العمر. يرجى المحاولة مرة أخرى."
  },
  "upload": {
    "age_restriction": "تقييد العمر",
    "restrict_to_18_plus": "تقييد المشاهدة لمن هم 18 عامًا فأكثر",
    "age_restriction_description": "فعّل هذا إذا كان الفيديو يحتوي على محتوى للبالغين غير مناسب للقاصرين",
    "restriction_reason": "سبب التقييد",
    "select_reason": "اختر سببًا",
    "reason_graphic_violence": "عنف صريح أو صور مزعجة",
    "reason_war_footage": "لقطات حرب أو صراع",
    "reason_mature_topics": "مواضيع حساسة أو للبالغين",
    "reason_medical_content": "إجراءات طبية أو محتوى صحي",
    "reason_sensitive_fiqh": "مواضيع فقهية حساسة",
    "reason_other": "محتوى آخر للبالغين",
    "warning": "تحذير",
    "age_restriction_warning": "الفيديوهات المقيدة بالعمر لها توزيع محدود وتتطلب تسجيل دخول المشاهدين"
  }
}
```

## Implementation Tasks

### Phase 1: Backend Implementation (Day 1 Morning)

- [ ] **Task 1.1**: Update shared types (30 min)
  - Add age restriction fields to VideoObject
  - Add dateOfBirth to Profile type
  - Create AgeVerificationResult type
  - Build shared-types package

- [ ] **Task 1.2**: Create age verification utility (30 min)
  - Create calculateAge function
  - Create verifyUserAge function
  - Add age verification middleware
  - Test edge cases (leap years, timezones)

- [ ] **Task 1.3**: Update video upload endpoints (45 min)
  - Modify uploadInitiate schema
  - Add age restriction validation
  - Update video creation logic
  - Test with Swagger UI

- [ ] **Task 1.4**: Implement age gate in video fetch (45 min)
  - Check age restriction on fetch
  - Return limited data for restricted videos
  - Implement age verification check
  - Test authenticated vs unauthenticated access

- [ ] **Task 1.5**: Create age verification endpoint (45 min)
  - Build AgeVerify endpoint class
  - Store date of birth in profile
  - Queue verification events
  - Add to router and test

- [ ] **Task 1.6**: Update video list filtering (30 min)
  - Filter age-restricted videos in public lists
  - Show restricted videos to verified adults
  - Update search endpoint
  - Test filtering logic

### Phase 2: Frontend Implementation (Day 1 Afternoon)

- [ ] **Task 2.1**: Create AgeGate component (45 min)
  - Build overlay UI component
  - Support bilingual text
  - Handle RTL layout
  - Create loading states

- [ ] **Task 2.2**: Create AgeVerificationForm component (45 min)
  - Build date picker form
  - Add confirmation checkbox
  - Handle API submission
  - Show error/success states

- [ ] **Task 2.3**: Update video upload form (30 min)
  - Add age restriction checkbox
  - Add reason selector dropdown
  - Show warning message
  - Update form submission

- [ ] **Task 2.4**: Create AgeBadge component (15 min)
  - Design 18+ badge
  - Position on thumbnails
  - Apply to video cards
  - Test visibility

- [ ] **Task 2.5**: Integrate age gate in video player (45 min)
  - Check restriction status
  - Show age gate overlay
  - Handle verification flow
  - Redirect after verification

- [ ] **Task 2.6**: Update video listing pages (30 min)
  - Show age badges on thumbnails
  - Filter restricted content for non-authenticated users
  - Update search results display
  - Test browse experience

### Phase 3: Testing & Polish (Day 2 Morning)

- [ ] **Task 3.1**: End-to-end testing (1 hour)
  - Test upload with age restriction
  - Test viewing as authenticated adult
  - Test viewing as authenticated minor
  - Test viewing as unauthenticated user
  - Test age verification flow

- [ ] **Task 3.2**: Edge cases testing (45 min)
  - Test date boundary conditions (exactly 18)
  - Test invalid dates
  - Test timezone handling
  - Test missing profile data

- [ ] **Task 3.3**: UI/UX polish (45 min)
  - Refine age gate design
  - Improve form validation messages
  - Add loading indicators
  - Test dark mode support

- [ ] **Task 3.4**: Documentation (30 min)
  - Update API documentation
  - Add feature guide for users
  - Document content guidelines
  - Update ROADMAP.md

## Testing Strategy

### Unit Tests
```typescript
// Test age calculation
describe('calculateAge', () => {
  it('calculates age correctly', () => {
    const dob = '2000-01-01';
    const age = calculateAge(dob);
    expect(age).toBeGreaterThanOrEqual(25); // In 2025
  });

  it('handles leap years', () => {
    const dob = '2004-02-29';
    const age = calculateAge(dob);
    expect(age).toBeDefined();
  });
});

// Test age verification
describe('verifyUserAge', () => {
  it('allows adults to view restricted content', () => {
    const profile = { dateOfBirth: '2000-01-01' };
    const result = verifyUserAge(profile);
    expect(result.isAdult).toBe(true);
  });

  it('blocks minors from restricted content', () => {
    const profile = { dateOfBirth: '2010-01-01' };
    const result = verifyUserAge(profile);
    expect(result.isAdult).toBe(false);
  });
});
```

### Integration Tests

1. **Upload Flow**
   - Upload video with age restriction
   - Verify ageRestricted flag is saved
   - Confirm reason is stored

2. **View Flow - Unauthenticated**
   - Attempt to view age-restricted video
   - Verify 403 response with auth required
   - Check limited video data returned

3. **View Flow - Authenticated Minor**
   - Sign in as user under 18
   - Attempt to view age-restricted video
   - Verify age verification required response

4. **View Flow - Authenticated Adult**
   - Sign in as user over 18
   - View age-restricted video
   - Verify full video data returned

5. **Age Verification Flow**
   - Submit date of birth
   - Verify profile updated
   - Confirm can now view restricted content

### Manual Testing Checklist

- [ ] Upload video with age restriction enabled
- [ ] View restricted video thumbnail (badge visible)
- [ ] Click restricted video as guest (see auth prompt)
- [ ] Sign in and see age gate
- [ ] Complete age verification
- [ ] View restricted video successfully
- [ ] Try to embed restricted video (should fail)
- [ ] Search for restricted videos (filtered when not verified)
- [ ] Test in Arabic with RTL layout
- [ ] Test on mobile devices
- [ ] Test with slow network
- [ ] Test error scenarios

## Security Considerations

1. **Age Verification Storage**
   - Store date of birth encrypted in profile
   - Never expose exact age in API responses
   - Log verification attempts for audit

2. **Access Control**
   - Enforce authentication for restricted content
   - Validate age on every access attempt
   - No client-side only restrictions

3. **Privacy Protection**
   - Minimal data collection (only DOB)
   - Clear privacy notice
   - GDPR/COPPA compliance considerations

4. **Abuse Prevention**
   - Rate limit age verification attempts
   - Monitor for suspicious patterns
   - Block obvious fake dates

## Performance Impact

- **Minimal overhead**: Single profile lookup for age check
- **Caching strategy**: Cache age verification status in JWT claims (future)
- **CDN considerations**: Age-restricted videos not cached publicly
- **Database impact**: One additional field per video and profile

## Migration Plan

1. **Database Migration**
   - Add ageRestricted field to existing videos (default: false)
   - Add dateOfBirth to existing profiles (default: null)
   - No breaking changes

2. **Gradual Rollout**
   - Deploy backend changes first
   - Deploy frontend with feature flag
   - Enable for select creators initially
   - Full rollout after testing

## Future Enhancements

1. **Parental Controls** (Phase 2)
   - Parent account can control child access
   - Time-based restrictions
   - Content category filtering

2. **Regional Compliance** (Phase 3)
   - Country-specific age limits
   - Local regulation compliance
   - IP-based restrictions

3. **Advanced Restrictions** (Phase 4)
   - Multiple age tiers (13+, 16+, 18+)
   - Content rating system
   - Creator-defined age ranges

4. **Analytics Integration** (Phase 5)
   - Track age verification metrics
   - Monitor restricted content performance
   - Compliance reporting

## Rollback Plan

If issues arise:

1. **Feature Flag Disable**
   - Turn off age restriction UI
   - Keep data but don't enforce

2. **Database Rollback**
   - Remove ageRestricted from new uploads
   - Keep existing data for recovery

3. **Full Revert**
   - Revert code changes
   - Clean up database fields
   - Communicate with users

## Success Metrics

- **Adoption Rate**: % of appropriate content marked as restricted
- **Verification Success**: % of users completing age verification
- **Compliance**: Zero age-inappropriate content viewed by minors
- **User Experience**: <5% drop-off at age gate
- **Performance**: <100ms additional latency for restriction check

## Conclusion

The Age Restriction Option is a critical safety feature that enables Al Ummah Now to host mature Islamic content while protecting minors. The implementation is straightforward, requiring minimal changes to the existing architecture while providing robust age verification and access control.

Total estimated implementation time: **1.5-2 days** with one developer, including testing and documentation.

---

**Document Status**: Ready for Implementation
**Next Steps**: Review with development team and begin Phase 1 tasks