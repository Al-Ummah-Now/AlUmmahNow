# Feature Implementation Plan: Paid Promotion Disclosure

## Feature Overview

Implementation of a paid promotion disclosure system that complies with US FTC regulations for sponsored content. This feature allows content creators to transparently disclose when their videos contain paid promotions, sponsorships, or product placements.

## Business Requirements

### Core Requirements
- **Disclosure Checkbox**: "Video contains paid promotion" option during upload/edit
- **Legal Compliance**: Meets US FTC requirements for sponsored content disclosure
- **Visual Notice**: Displays "Includes paid promotion" badge on video player
- **Timing**: Shows disclosure for first 10 seconds of video playback
- **Persistent Information**: Included in video description permanently
- **Creator Control**: Optional field that creators can enable/disable per video

### Use Cases
1. **Islamic Book Reviews**: Scholars reviewing books with publisher sponsorship
2. **Halal Product Reviews**: Content about halal-certified products with brand partnerships
3. **Educational Sponsorships**: Islamic education platforms sponsoring content
4. **Charity Partnerships**: Disclosure for charity/zakat organization promotions
5. **Event Promotions**: Islamic conferences/events with paid promotions
6. **Course Promotions**: Online Islamic course sponsorships

## Technical Architecture

### Data Model Changes

#### Video Object Schema
```typescript
// packages/shared-types/src/video.ts
interface VideoObject {
  // Existing fields...

  // Paid Promotion Fields
  hasPaidPromotion: boolean;
  paidPromotionDetails?: {
    enabled: boolean;
    disclosureText?: string; // Custom disclosure text (optional)
    sponsors?: Array<{
      name: string;
      type: 'product_placement' | 'sponsorship' | 'endorsement';
      url?: string;
    }>;
    displayDuration?: number; // Seconds to display (default: 10)
    createdAt: string;
    updatedAt: string;
  };
}
```

### API Endpoints

#### 1. Video Upload/Edit Endpoints
```
POST /videos
PUT /videos/{id}

Request Body Addition:
{
  hasPaidPromotion: boolean,
  paidPromotionDetails?: {
    sponsors?: Array<{
      name: string,
      type: string,
      url?: string
    }>
  }
}
```

#### 2. Paid Promotion Analytics Endpoint
```
GET /analytics/paid-promotions
Response: Statistics about paid promotion videos
```

### Frontend Components

#### 1. Upload Form Component
```
Location: apps/web/src/components/VideoUpload/PaidPromotionSection.tsx
Features:
- Checkbox: "This video contains paid promotion"
- Expandable details section when checked
- Sponsor information fields (optional)
- Preview of disclosure badge
```

#### 2. Video Player Overlay
```
Location: apps/web/src/components/VideoPlayer/PaidPromotionBadge.tsx
Features:
- Semi-transparent overlay badge
- Position: Top-left corner of video
- Fade in/out animation
- Timer-based display (10 seconds default)
- Responsive design for mobile
```

#### 3. Video Description Component
```
Location: apps/web/src/components/VideoDetails/PaidPromotionDisclosure.tsx
Features:
- Permanent disclosure in description
- Icon indicator
- Expandable sponsor details
- Bilingual support (EN/AR)
```

## Implementation Details

### Phase 1: Backend Implementation (Week 1)

#### Tasks:
1. **Update Video Schema**
   - Add `hasPaidPromotion` field to VideoObject type
   - Add `paidPromotionDetails` nested object
   - Update validation schemas

2. **API Endpoint Updates**
   - Modify video creation endpoint
   - Modify video update endpoint
   - Add validation for paid promotion fields
   - Update OpenAPI documentation

3. **R2 Storage Updates**
   - Ensure new fields are persisted
   - Add migration script for existing videos (default: false)

4. **Queue Processing**
   - Add paid promotion events to processor
   - Track analytics for sponsored content

### Phase 2: Frontend Implementation (Week 2)

#### Tasks:
1. **Upload Form Enhancement**
   - Create PaidPromotionSection component
   - Add checkbox with expandable details
   - Implement bilingual labels
   - Add form validation

2. **Video Player Integration**
   - Create PaidPromotionBadge component
   - Implement timer logic (10-second display)
   - Add fade animations
   - Position overlay correctly
   - Handle mobile responsiveness

3. **Description Display**
   - Create PaidPromotionDisclosure component
   - Add to video details page
   - Implement expandable sponsor list
   - Style with appropriate icons

### Phase 3: Compliance & Analytics (Week 3)

#### Tasks:
1. **Compliance Features**
   - Add FTC compliance disclaimer text
   - Implement region-specific requirements
   - Add terms of service updates

2. **Analytics Dashboard**
   - Track paid promotion video metrics
   - Creator earnings insights
   - Sponsor performance metrics

3. **Admin Controls**
   - Review system for paid promotions
   - Flag inappropriate disclosures
   - Audit trail for compliance

## File Structure

### New Files to Create
```
apps/web/src/components/
├── VideoUpload/
│   └── PaidPromotionSection.tsx
│   └── PaidPromotionSection.rtl.tsx
├── VideoPlayer/
│   └── PaidPromotionBadge.tsx
│   └── PaidPromotionBadge.rtl.tsx
└── VideoDetails/
    └── PaidPromotionDisclosure.tsx
    └── PaidPromotionDisclosure.rtl.tsx

apps/api-videos/src/endpoints/videos/
└── paidPromotion.ts

packages/shared-types/src/
└── paidPromotion.ts
```

### Files to Modify
```
packages/shared-types/src/video.ts
apps/api-videos/src/endpoints/videos/create.ts
apps/api-videos/src/endpoints/videos/update.ts
apps/api-videos/src/endpoints/videos/get.ts
apps/web/src/app/[locale]/upload/page.tsx
apps/web/src/app/[locale]/video/[id]/page.tsx
apps/web/src/components/VideoPlayer/VideoPlayer.tsx
apps/processor/src/handlers/videoHandler.ts
```

## Testing Strategy

### Unit Tests
1. **API Tests**
   - Validation of paid promotion fields
   - Proper storage in R2
   - Correct response format

2. **Component Tests**
   - Checkbox functionality
   - Badge display timer
   - Disclosure rendering

### Integration Tests
1. **Upload Flow**
   - Complete upload with paid promotion
   - Edit existing video to add/remove promotion
   - Verify data persistence

2. **Playback Flow**
   - Badge appears on video start
   - Badge disappears after 10 seconds
   - Description shows disclosure

### E2E Tests
1. **Creator Journey**
   - Upload sponsored content
   - View as creator
   - Edit disclosure details

2. **Viewer Journey**
   - Watch sponsored video
   - See disclosure badge
   - View sponsor details

### Compliance Tests
1. **FTC Requirements**
   - Disclosure visibility
   - Timing requirements
   - Text clarity

2. **Accessibility**
   - Screen reader compatibility
   - Keyboard navigation
   - Color contrast

## Internationalization

### Translation Keys
```json
{
  "paidPromotion": {
    "checkbox": "This video contains paid promotion",
    "badge": "Includes paid promotion",
    "description": "This content includes paid promotion",
    "sponsors": "Sponsors",
    "ftcDisclaimer": "Paid promotions disclosed in compliance with FTC guidelines",
    "learnMore": "Learn more about paid promotions",
    "sponsorTypes": {
      "product_placement": "Product placement",
      "sponsorship": "Sponsorship",
      "endorsement": "Paid endorsement"
    }
  }
}
```

### Arabic Translations
```json
{
  "paidPromotion": {
    "checkbox": "يحتوي هذا الفيديو على ترويج مدفوع",
    "badge": "يتضمن ترويجاً مدفوعاً",
    "description": "يحتوي هذا المحتوى على ترويج مدفوع",
    "sponsors": "الرعاة",
    "ftcDisclaimer": "تم الإفصاح عن الترويج المدفوع وفقاً لإرشادات FTC",
    "learnMore": "اعرف المزيد عن الترويج المدفوع",
    "sponsorTypes": {
      "product_placement": "وضع المنتج",
      "sponsorship": "الرعاية",
      "endorsement": "التأييد المدفوع"
    }
  }
}
```

## Security Considerations

1. **Input Validation**
   - Sanitize sponsor URLs
   - Validate sponsor names
   - Prevent XSS in custom disclosure text

2. **Authorization**
   - Only video owner can set paid promotion
   - Admin override capabilities
   - Audit logging for changes

3. **Data Protection**
   - Encrypt sponsor information at rest
   - GDPR compliance for sponsor data
   - Data retention policies

## Performance Considerations

1. **Video Player**
   - Lazy load badge component
   - Use CSS animations (no JavaScript)
   - Minimize re-renders during playback

2. **API Optimization**
   - Include paid promotion in video response
   - No additional API calls needed
   - Cache disclosure data

3. **Storage Efficiency**
   - Store as boolean when no details
   - Compress sponsor arrays
   - Index by promotion status

## Monitoring & Analytics

### Metrics to Track
1. **Usage Metrics**
   - Videos with paid promotions (count/percentage)
   - Average sponsors per video
   - Most common sponsor types

2. **Compliance Metrics**
   - Videos missing required disclosures
   - Badge display success rate
   - User complaints about disclosures

3. **Performance Metrics**
   - Badge load time
   - Player performance impact
   - API response times

### Logging Requirements
```typescript
// Log structure for paid promotion events
{
  event: "paid_promotion_displayed",
  videoId: string,
  userId: string,
  displayDuration: number,
  sponsors: string[],
  timestamp: string
}
```

## Rollout Strategy

### Phase 1: Beta Testing (Week 4)
- Enable for select creators
- Gather feedback on UX
- Monitor compliance

### Phase 2: Soft Launch (Week 5)
- Enable for all creators (opt-in)
- Educational content about feature
- Monitor adoption rates

### Phase 3: Full Launch (Week 6)
- Feature announcement
- Creator guidelines published
- Compliance monitoring active

## Success Criteria

1. **Adoption**: 20% of eligible videos use feature within 3 months
2. **Compliance**: 100% FTC compliance for disclosed content
3. **Performance**: No impact on video load time (< 50ms)
4. **User Satisfaction**: > 90% positive feedback from creators
5. **Transparency**: 95% of viewers notice disclosure badge

## Risk Mitigation

### Risks and Mitigations
1. **Risk**: Creators forget to disclose
   - **Mitigation**: Reminder in upload flow, periodic audits

2. **Risk**: Badge blocks important content
   - **Mitigation**: Semi-transparent, positioned in corner

3. **Risk**: Performance impact on player
   - **Mitigation**: Lightweight component, CSS-only animations

4. **Risk**: Legal non-compliance
   - **Mitigation**: Regular legal review, automated compliance checks

## Future Enhancements

1. **Advanced Sponsor Management**
   - Sponsor database
   - Auto-complete sponsor names
   - Sponsor verification system

2. **Enhanced Analytics**
   - Sponsor performance metrics
   - ROI calculations
   - Viewer engagement with sponsored content

3. **Automated Detection**
   - ML-based detection of undisclosed promotions
   - Content scanning for brand mentions
   - Automated compliance alerts

4. **Creator Tools**
   - Bulk update for multiple videos
   - Sponsor contract management
   - Revenue tracking integration

## Documentation Requirements

1. **Creator Documentation**
   - How to use paid promotion disclosure
   - Best practices for transparency
   - FTC guidelines summary

2. **API Documentation**
   - OpenAPI spec updates
   - Example requests/responses
   - Migration guide

3. **Compliance Documentation**
   - Legal requirements by region
   - Audit procedures
   - Violation handling process

## Conclusion

This paid promotion disclosure feature ensures Al Ummah Now platform maintains transparency and legal compliance while supporting creator monetization through sponsorships. The implementation focuses on user experience, legal compliance, and platform integrity while providing flexibility for various Islamic content sponsorship models.

## Implementation Checklist

- [ ] Backend schema updates
- [ ] API endpoint modifications
- [ ] Frontend upload form component
- [ ] Video player badge component
- [ ] Description disclosure component
- [ ] Bilingual translations
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] Documentation updates
- [ ] Legal review
- [ ] Performance testing
- [ ] Security audit
- [ ] Beta testing
- [ ] Creator education materials
- [ ] Launch announcement