# Multi-Language Support Implementation Guide

This guide provides a step-by-step implementation plan for adding multi-language support to Al Ummah Now's Profile, Channel, and Video entities.

## Overview

The implementation follows a **field-level localization pattern** with backward compatibility. Content can be stored in multiple languages (English and Arabic) with intelligent fallback chains.

## Implementation Phases

### Phase 1: Foundation (Priority: HIGH)
**Status:** ✅ Complete

#### 1.1 Shared Types Package
- ✅ `/packages/shared-types/src/localization.ts` - Core localization types and helpers
- ✅ `/packages/shared-types/src/video-localized.ts` - Video-specific localization types
- ✅ `/packages/shared-types/src/channel-localized.ts` - Channel-specific localization types
- ✅ `/packages/shared-types/src/profile-localized.ts` - Profile-specific localization types
- ✅ `/packages/shared-types/src/index.ts` - Export new types

**Build Command:**
```bash
pnpm --filter @al-ummah/shared-types build
```

### Phase 2: UI Components (Priority: HIGH)
**Status:** ✅ Complete

#### 2.1 React Hooks
- ✅ `/apps/web/src/hooks/useLocalizedContent.ts` - Hook for managing localized content

#### 2.2 Form Components
- ✅ `/apps/web/src/components/forms/LocalizedTextField.tsx` - Multi-language input component

### Phase 3: API Layer Updates (Priority: HIGH)
**Status:** 🔄 TODO

#### 3.1 Profile Endpoints
Files to update:
- `/apps/api-videos/src/endpoints/profile/profileCreate.ts`
- `/apps/api-videos/src/endpoints/profile/profileUpdate.ts`
- `/apps/api-videos/src/endpoints/profile/profileGet.ts`
- `/apps/api-videos/src/endpoints/profile/profileList.ts`

**Changes needed:**
```typescript
// In profileUpdate.ts
import { LocalizationHelper, parseAcceptLanguage } from '@al-ummah/shared-types';

// In handle method:
const lang = parseAcceptLanguage(c.req.header('Accept-Language'));

// Before saving:
if (profile.displayNameLocalized || profile.bioLocalized) {
  // Update legacy fields from localized content
  profile.displayName = LocalizationHelper.getValue(
    profile.displayNameLocalized,
    profile.displayName,
    profile.defaultLanguage || 'en'
  );
}

// Before returning:
const localizedProfile = LocalizationHelper.transformForResponse(
  profile,
  lang,
  ['displayName', 'firstName', 'lastName', 'bio']
);
```

#### 3.2 Channel Endpoints
Files to update:
- `/apps/api-videos/src/endpoints/channel/channelCreate.ts`
- `/apps/api-videos/src/endpoints/channel/channelUpdate.ts`
- `/apps/api-videos/src/endpoints/channel/channelGet.ts`
- `/apps/api-videos/src/endpoints/channel/channelList.ts`

#### 3.3 Video Endpoints
Files to update:
- `/apps/api-videos/src/endpoints/video/videoCreate.ts`
- `/apps/api-videos/src/endpoints/video/videoUpdate.ts`
- `/apps/api-videos/src/endpoints/video/videoGet.ts`
- `/apps/api-videos/src/endpoints/video/videoList.ts`
- `/apps/api-videos/src/endpoints/video/videoSearch.ts`

#### 3.4 Input/View Models
Files to update:
- `/apps/api-videos/src/lib/model/input.ts` - Add localized fields to input schemas
- `/apps/api-videos/src/lib/model/view.ts` - Add localized fields to view schemas

**Example schema update:**
```typescript
// In input.ts
export const VideoCreateInput = z.object({
  title: Str({ description: "Video title" }),
  titleLocalized: z.object({
    en: z.string().optional(),
    ar: z.string().optional()
  }).optional(),
  description: Str({ description: "Video description" }).optional(),
  descriptionLocalized: z.object({
    en: z.string().optional(),
    ar: z.string().optional()
  }).optional(),
  defaultLanguage: z.enum(['en', 'ar']).optional(),
  // ... rest of fields
});
```

### Phase 4: Frontend Forms (Priority: MEDIUM)
**Status:** 🔄 TODO

#### 4.1 Profile Forms
Files to update:
- `/apps/web/src/app/en/profile/create/page.tsx`
- `/apps/web/src/app/ar/profile/create/page.tsx`
- `/apps/web/src/app/en/profile/edit/page.tsx`
- `/apps/web/src/app/ar/profile/edit/page.tsx`
- `/apps/web/src/components/profile/ProfileForm.tsx` (if exists)

**Example form update:**
```tsx
import { LocalizedTextField } from '@/components/forms/LocalizedTextField';
import { useState } from 'react';

function ProfileForm() {
  const [displayNameLocalized, setDisplayNameLocalized] = useState({});
  const [bioLocalized, setBioLocalized] = useState({});

  return (
    <form>
      <LocalizedTextField
        name="displayName"
        label="Display Name"
        value={displayNameLocalized}
        onChange={setDisplayNameLocalized}
        required
      />

      <LocalizedTextField
        name="bio"
        label="Bio"
        value={bioLocalized}
        onChange={setBioLocalized}
        multiline
        rows={4}
        maxLength={500}
      />
    </form>
  );
}
```

#### 4.2 Channel Forms
Files to update:
- `/apps/web/src/components/channelManagement/CreateChannelForm.tsx`
- `/apps/web/src/components/channelManagement/EditChannelForm.tsx`

#### 4.3 Video Forms
Files to update:
- `/apps/web/src/components/videoUpload/index.tsx`
- `/apps/web/src/components/videoUpload/VideoEditForm.tsx` (if exists)

### Phase 5: Display Components (Priority: MEDIUM)
**Status:** 🔄 TODO

#### 5.1 Profile Display
Files to update:
- `/apps/web/src/components/profile/ProfileCard.tsx`
- `/apps/web/src/components/profile/ProfileHeader.tsx`

**Example display update:**
```tsx
import { useLocalizedProfile } from '@/hooks/useLocalizedContent';

function ProfileCard({ profile }) {
  const localizedProfile = useLocalizedProfile(profile);

  return (
    <div>
      <h2>{localizedProfile?.displayName}</h2>
      <p>{localizedProfile?.bio}</p>
    </div>
  );
}
```

#### 5.2 Channel Display
Files to update:
- `/apps/web/src/components/ChannelCard.tsx`
- `/apps/web/src/components/ChannelHeader.tsx`
- `/apps/web/src/components/ChannelSelector/index.tsx`

#### 5.3 Video Display
Files to update:
- `/apps/web/src/components/VideoCard.tsx`
- `/apps/web/src/components/VideoPlayer.tsx`
- `/apps/web/src/components/VideoList.tsx`

### Phase 6: API Client Updates (Priority: LOW)
**Status:** 🔄 TODO

Files to update:
- `/apps/web/src/lib/api/profiles.ts`
- `/apps/web/src/lib/api/channels.ts`
- `/apps/web/src/lib/api/videos.ts`

**Add Accept-Language header:**
```typescript
// In API client functions
const headers = {
  'Accept-Language': getCurrentLanguage(), // 'en' or 'ar'
  ...otherHeaders
};
```

### Phase 7: Migration Scripts (Priority: LOW)
**Status:** 🔄 TODO

Create optional migration scripts:
- `/scripts/migrate-profiles-localization.ts`
- `/scripts/migrate-channels-localization.ts`
- `/scripts/migrate-videos-localization.ts`

**Example migration script:**
```typescript
import { LocalizationHelper } from '@al-ummah/shared-types';

async function migrateProfiles() {
  const profiles = await getAllProfiles();

  for (const profile of profiles) {
    // Detect language of existing content
    const displayNameLang = LocalizationHelper.detectLanguage(profile.displayName);
    const bioLang = LocalizationHelper.detectLanguage(profile.bio);

    // Migrate to localized structure
    LocalizationHelper.migrateLegacyField(profile, 'displayName', displayNameLang);
    LocalizationHelper.migrateLegacyField(profile, 'bio', bioLang);

    // Save updated profile
    await saveProfile(profile);
  }
}
```

## Testing Checklist

### Unit Tests
- [ ] LocalizationHelper functions
- [ ] useLocalizedContent hook
- [ ] LocalizedTextField component
- [ ] Fallback chain logic
- [ ] Language detection

### Integration Tests
- [ ] API endpoints with Accept-Language header
- [ ] Form submission with multi-language content
- [ ] Display components with different languages
- [ ] Legacy data compatibility

### E2E Tests
- [ ] Create profile with bilingual content
- [ ] Edit channel with Arabic content
- [ ] Upload video with English/Arabic titles
- [ ] Switch between /en and /ar routes
- [ ] Search in different languages

## Deployment Steps

1. **Build and test shared-types package:**
   ```bash
   pnpm --filter @al-ummah/shared-types build
   pnpm --filter @al-ummah/shared-types test
   ```

2. **Deploy API changes:**
   ```bash
   cd apps/api-videos
   pnpm deploy
   ```

3. **Deploy frontend:**
   ```bash
   cd apps/web
   pnpm build
   pnpm deploy:production
   ```

4. **Run migration (optional):**
   ```bash
   pnpm tsx scripts/migrate-profiles-localization.ts
   ```

## Monitoring

### Metrics to Track
- API response times with localization overhead
- Storage growth from localized content
- Cache hit rates for different languages
- User engagement by language

### Alerts to Configure
- Localization helper errors
- Missing translations for requested language
- Storage quota warnings
- Performance degradation

## Common Issues & Solutions

### Issue 1: Legacy data not showing
**Solution:** Ensure fallback chain includes legacy fields

### Issue 2: Wrong language displayed
**Solution:** Check Accept-Language header parsing

### Issue 3: Form validation errors
**Solution:** Validate at least one language has content

### Issue 4: RTL/LTR mixing
**Solution:** Use proper dir attributes and CSS isolation

## API Examples

### Creating a Video with Localization
```bash
curl -X POST http://api.alummahnow.net/api/videos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept-Language: ar" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Introduction to Islam",
    "titleLocalized": {
      "en": "Introduction to Islam",
      "ar": "مقدمة في الإسلام"
    },
    "description": "A comprehensive guide",
    "descriptionLocalized": {
      "en": "A comprehensive guide to understanding Islam",
      "ar": "دليل شامل لفهم الإسلام"
    },
    "defaultLanguage": "en",
    "videoUrl": "https://bunny.net/video.mp4"
  }'
```

### Fetching with Language Preference
```bash
# Get English version
curl http://api.alummahnow.net/api/videos/123 \
  -H "Accept-Language: en"

# Get Arabic version
curl http://api.alummahnow.net/api/videos/123 \
  -H "Accept-Language: ar"
```

## Next Steps

1. **Immediate Actions:**
   - Review and approve ADR-001
   - Build shared-types package with new localization support
   - Start with Profile entity as pilot

2. **Short Term (1-2 weeks):**
   - Implement API layer changes
   - Update frontend forms
   - Test with sample bilingual content

3. **Medium Term (3-4 weeks):**
   - Complete all entity migrations
   - Deploy to staging
   - User acceptance testing

4. **Long Term:**
   - Add more languages (Urdu, Turkish)
   - Implement translation workflow
   - Add automatic translation suggestions

## Resources

- [ADR-001: Multi-Language Support](/docs/architecture/ADR-001-multi-language-support.md)
- [LocalizationHelper API](/packages/shared-types/src/localization.ts)
- [React Hooks Documentation](/apps/web/src/hooks/useLocalizedContent.ts)
- [Component Examples](/apps/web/src/components/forms/LocalizedTextField.tsx)

## Contact

For questions or issues with the implementation:
- Create a GitHub issue with label `i18n`
- Tag `@architecture-team` for design questions
- Tag `@frontend-team` for UI implementation
- Tag `@backend-team` for API changes