# Feature Implementation Plan: Monetization Controls During Upload

## Feature Overview
Comprehensive monetization settings available during video upload, with Islamic-compliant monetization options including halal ad networks, donation alternatives, and special considerations for religious content.

## 1. Data Models

### 1.1 Monetization Settings Schema
```typescript
// packages/shared-types/src/monetization.ts

export interface MonetizationSettings {
  id: string;
  videoId: string;
  enabled: boolean;

  // Ad Configuration
  adConfig: {
    enabled: boolean;
    types: AdType[];
    midRollStrategy: 'manual' | 'automatic' | 'none';
    midRollPositions?: number[]; // timestamps in seconds
    minimumVideoDuration: number; // 480 seconds (8 minutes) for mid-roll

    // Islamic Compliance
    halalOnly: boolean;
    excludeCategories: string[]; // e.g., ['alcohol', 'gambling', 'interest-based']
    allowedNetworks: string[]; // e.g., ['halal-ads', 'islamic-network']
  };

  // Donation/Sadaqah Alternative
  donationConfig: {
    enabled: boolean;
    type: 'sadaqah' | 'zakat' | 'general';
    recipientOptions: DonationRecipient[];
    suggestedAmounts: number[];
    customMessage?: string;
    displayPosition: 'below-player' | 'sidebar' | 'end-screen';
  };

  // Revenue Sharing
  revenueShare: {
    creatorPercentage: number; // e.g., 55%
    platformPercentage: number; // e.g., 45%
    charityPercentage?: number; // Optional charity share
    charityRecipient?: string; // Charity ID
  };

  // Content Suitability
  contentRating: {
    selfCertified: boolean;
    categories: ContentCategory[];
    religiousContent: boolean;
    educationalContent: boolean;
    excludeFromMonetization?: string[]; // Reasons for exclusion
  };

  // Analytics
  estimatedRevenue?: {
    monthly: number;
    currency: string;
    lastUpdated: Date;
  };

  createdAt: Date;
  updatedAt: Date;
}

export enum AdType {
  DISPLAY = 'display',
  OVERLAY = 'overlay',
  SKIPPABLE = 'skippable',
  NON_SKIPPABLE = 'non-skippable',
  BUMPER = 'bumper',
  SPONSORED = 'sponsored'
}

export interface DonationRecipient {
  id: string;
  name: string;
  type: 'mosque' | 'charity' | 'education' | 'creator' | 'custom';
  verified: boolean;
  description: string;
  logoUrl?: string;
  categories: string[]; // e.g., ['orphans', 'education', 'healthcare']
}

export interface ContentCategory {
  id: string;
  name: string;
  halal: boolean;
  description: string;
}

export interface AdPlacement {
  id: string;
  videoId: string;
  type: 'pre-roll' | 'mid-roll' | 'post-roll';
  timestamp?: number; // For mid-roll
  duration: number; // Ad duration in seconds
  skippableAfter?: number; // Seconds before skip button appears
}
```

### 1.2 Halal Ad Network Integration
```typescript
// packages/shared-types/src/halal-ads.ts

export interface HalalAdNetwork {
  id: string;
  name: string;
  apiEndpoint: string;
  supportedRegions: string[];
  supportedLanguages: string[];

  compliance: {
    shariahCertified: boolean;
    certificationBody?: string;
    certificationDate?: Date;
    excludedCategories: string[];
  };

  adFormats: {
    video: boolean;
    display: boolean;
    native: boolean;
    audio: boolean;
  };

  revenueModel: {
    type: 'cpm' | 'cpc' | 'cpa';
    minimumPayout: number;
    payoutFrequency: 'weekly' | 'monthly';
    currency: string;
  };
}

export interface HalalAdRequest {
  videoId: string;
  contentCategories: string[];
  viewerLocation?: string;
  viewerLanguage?: string;
  excludeCategories: string[];
  adTypes: AdType[];
  maxDuration?: number;
}
```

## 2. API Endpoints

### 2.1 Monetization Settings Management
```typescript
// apps/api-videos/src/endpoints/monetization/

POST   /api/videos/{videoId}/monetization
GET    /api/videos/{videoId}/monetization
PUT    /api/videos/{videoId}/monetization
DELETE /api/videos/{videoId}/monetization

// Ad Placement Management
POST   /api/videos/{videoId}/monetization/ad-placements
GET    /api/videos/{videoId}/monetization/ad-placements
PUT    /api/videos/{videoId}/monetization/ad-placements/{placementId}
DELETE /api/videos/{videoId}/monetization/ad-placements/{placementId}

// Donation Configuration
POST   /api/videos/{videoId}/monetization/donation
GET    /api/videos/{videoId}/monetization/donation
PUT    /api/videos/{videoId}/monetization/donation

// Analytics
GET    /api/videos/{videoId}/monetization/analytics
GET    /api/videos/{videoId}/monetization/estimated-revenue

// Halal Networks
GET    /api/monetization/halal-networks
GET    /api/monetization/halal-networks/{networkId}/status
POST   /api/monetization/halal-networks/{networkId}/connect
```

## 3. UI Components

### 3.1 Upload Form Monetization Section
```typescript
// apps/web/src/components/Upload/MonetizationSection.tsx

Components:
- MonetizationToggle: Enable/disable monetization
- AdTypeSelector: Multi-select for ad types
- MidRollEditor: Visual timeline for ad placement
- HalalComplianceSettings: Islamic compliance options
- DonationConfiguration: Sadaqah/charity settings
- RevenueSharingConfig: Revenue distribution settings
- ContentRatingForm: Self-certification
- EstimatedRevenueDisplay: Potential earnings preview
```

### 3.2 Ad Placement Timeline Editor
```typescript
// apps/web/src/components/Monetization/AdPlacementEditor.tsx

Features:
- Visual timeline with video preview
- Drag-and-drop ad markers
- Automatic placement suggestions
- Chapter-aware placement (avoid interrupting chapters)
- Prayer time awareness (no ads during prayer times)
- Minimum spacing enforcement (at least 7 minutes between mid-rolls)
- Preview mode with ad simulation
```

### 3.3 Islamic Monetization Options
```typescript
// apps/web/src/components/Monetization/IslamicOptions.tsx

Components:
- HalalToggle: Enable halal-only ads
- CategoryExclusions: Checkboxes for haram categories
- DonationAlternative: Enable donation instead of ads
- CharitySelector: Choose verified Islamic charities
- ZakatCalculator: Optional zakat on earnings
- SadaqahJariyah: Continuous charity options
```

## 4. Implementation Phases

### Phase 1: Core Monetization Settings (Week 1-2)
- [ ] Create monetization data models
- [ ] Implement basic API endpoints
- [ ] Build monetization toggle in upload form
- [ ] Add ad type selection UI
- [ ] Create monetization settings storage in R2

### Phase 2: Ad Placement System (Week 3-4)
- [ ] Build ad placement timeline editor
- [ ] Implement mid-roll validation (8+ minutes)
- [ ] Add automatic placement algorithm
- [ ] Create preview functionality
- [ ] Implement placement API endpoints

### Phase 3: Islamic Compliance (Week 5-6)
- [ ] Add halal-only toggle
- [ ] Implement category exclusions
- [ ] Build donation configuration UI
- [ ] Create charity/mosque selector
- [ ] Add Islamic content indicators

### Phase 4: Revenue & Analytics (Week 7-8)
- [ ] Implement revenue sharing configuration
- [ ] Build estimated revenue calculator
- [ ] Create analytics dashboard
- [ ] Add payout management
- [ ] Implement reporting features

### Phase 5: Halal Network Integration (Week 9-10)
- [ ] Research halal ad networks
- [ ] Build network adapter pattern
- [ ] Implement API integrations
- [ ] Add network selection UI
- [ ] Create fallback mechanisms

## 5. Technical Implementation Details

### 5.1 R2 Storage Structure
```
monetization/
├── settings/
│   └── {videoId}.json           # Monetization settings per video
├── ad-placements/
│   └── {videoId}/
│       └── placements.json       # Ad placement data
├── donations/
│   └── {videoId}/
│       └── config.json           # Donation configuration
├── analytics/
│   └── {videoId}/
│       └── {date}/
│           └── revenue.json      # Daily revenue data
└── networks/
    └── {networkId}/
        └── config.json           # Network configuration
```

### 5.2 Queue Processing
```typescript
// apps/processor/src/handlers/monetization.ts

export interface MonetizationEvent {
  type: 'ad_served' | 'ad_clicked' | 'donation_made' | 'revenue_calculated';
  videoId: string;
  userId?: string;
  amount?: number;
  currency?: string;
  networkId?: string;
  timestamp: Date;
}
```

### 5.3 WebSocket Real-time Updates
```typescript
// apps/websocket-server/src/channels/monetization.ts

Channels:
- monetization:{videoId} - Real-time revenue updates
- donations:{videoId} - Live donation notifications
- analytics:{creatorId} - Creator dashboard updates
```

## 6. Islamic Considerations

### 6.1 Halal Compliance Requirements
1. **Ad Content Filtering**
   - No alcohol, gambling, or interest-based products
   - No inappropriate imagery or music
   - No promotion of haram activities
   - Verified halal business advertisers only

2. **Religious Content Protection**
   - Quran recitation videos: No mid-roll ads
   - Prayer/worship content: Donation-only option
   - Islamic lectures: Contextual ad placement
   - Ramadan content: Special monetization rules

3. **Transparent Revenue Model**
   - Clear explanation of revenue sources
   - Shariah-compliant profit sharing
   - No hidden fees or interest
   - Option to donate platform share

### 6.2 Donation/Sadaqah Features
1. **Donation Types**
   - One-time Sadaqah
   - Recurring donations (monthly)
   - Zakat contributions (2.5% option)
   - Sadaqah Jariyah (continuous charity)
   - Waqf contributions (endowment)

2. **Recipient Options**
   - Direct to content creator
   - Verified mosques
   - Islamic charities
   - Educational institutions
   - Split donations (multiple recipients)

3. **Transparency Features**
   - Donation tracking
   - Tax receipts (where applicable)
   - Impact reporting
   - Charity verification badges

## 7. Files to Create/Modify

### New Files
```
packages/shared-types/src/
├── monetization.ts
├── halal-ads.ts
└── donations.ts

apps/api-videos/src/endpoints/monetization/
├── index.ts
├── settings.ts
├── ad-placements.ts
├── donations.ts
├── analytics.ts
└── networks.ts

apps/web/src/components/Upload/
├── MonetizationSection.tsx
└── MonetizationSection.test.tsx

apps/web/src/components/Monetization/
├── AdPlacementEditor.tsx
├── AdTypeSelector.tsx
├── IslamicOptions.tsx
├── DonationConfig.tsx
├── RevenueDisplay.tsx
├── ContentRating.tsx
├── HalalNetworkSelector.tsx
└── index.ts

apps/web/src/lib/monetization/
├── client.ts
├── validators.ts
├── calculators.ts
└── constants.ts

apps/processor/src/handlers/
└── monetization.ts

apps/websocket-server/src/channels/
└── monetization.ts
```

### Modified Files
```
apps/api-videos/src/
└── index.ts (register monetization routes)

apps/web/src/app/[locale]/upload/
└── page.tsx (add monetization section)

apps/web/src/app/[locale]/watch/
└── page.tsx (implement ad serving/donation display)

apps/web/src/lib/api/
└── index.ts (add monetization client)

packages/shared-types/src/
└── index.ts (export monetization types)
```

## 8. Testing Strategy

### 8.1 Unit Tests
```typescript
// apps/api-videos/src/__tests__/monetization/

- Monetization settings CRUD
- Ad placement validation
- Revenue calculation
- Donation processing
- Network integration
- Islamic compliance checks
```

### 8.2 Integration Tests
```typescript
// apps/web/src/__tests__/monetization/

- Upload form with monetization
- Ad placement editor interactions
- Donation flow end-to-end
- Analytics dashboard
- Real-time revenue updates
```

### 8.3 E2E Tests
```typescript
// e2e/monetization/

Scenarios:
1. Enable monetization during upload
2. Configure ad placements
3. Set up donation alternative
4. View revenue analytics
5. Process donation payment
6. Verify halal ad serving
```

### 8.4 Islamic Compliance Testing
- Verify haram content filtering
- Test prayer time ad blocking
- Validate Quran content protection
- Check donation flow compliance
- Verify zakat calculations

## 9. Security Considerations

### 9.1 Revenue Protection
- Secure revenue calculations server-side
- Encrypt payment information
- Audit trail for all transactions
- Fraud detection mechanisms
- Rate limiting on donation API

### 9.2 Ad Network Security
- Validate ad content before serving
- Sandboxed ad rendering
- CSP headers for ad domains
- Regular security audits
- Network API key rotation

### 9.3 User Privacy
- Anonymous donation options
- GDPR-compliant data handling
- Transparent data usage
- Opt-out mechanisms
- Secure payment processing

## 10. Performance Optimization

### 10.1 Ad Loading
- Lazy load ad SDKs
- Preload ad content
- Client-side caching
- CDN for ad assets
- Fallback ad sources

### 10.2 Analytics Processing
- Queue-based revenue calculation
- Batch processing for analytics
- Caching of revenue data
- Efficient R2 queries
- Real-time vs batch trade-offs

## 11. Future Enhancements

### 11.1 Advanced Features
- AI-powered ad placement suggestions
- Dynamic pricing based on content performance
- Multi-currency support
- Sponsorship marketplace
- Creator funds distribution

### 11.2 Islamic Features
- Ramadan special monetization
- Hajj/Umrah fundraising tools
- Islamic crowdfunding integration
- Waqf management system
- Zakat distribution network

### 11.3 Analytics Enhancements
- Predictive revenue modeling
- A/B testing for ad placements
- Viewer sentiment analysis
- Optimal upload time suggestions
- Competition analysis

## 12. Success Metrics

### 12.1 Adoption Metrics
- % of videos with monetization enabled
- Average revenue per video
- Donation conversion rate
- Creator satisfaction score
- Ad fill rate

### 12.2 Islamic Metrics
- % using halal-only ads
- Donation volume
- Charity contributions
- Religious content protection rate
- User trust score

### 12.3 Technical Metrics
- Ad loading time
- Revenue calculation accuracy
- API response times
- Error rates
- System uptime

## 13. Documentation Requirements

### 13.1 User Documentation
- Monetization setup guide
- Islamic monetization FAQ
- Donation configuration tutorial
- Revenue analytics guide
- Best practices for ad placement

### 13.2 Developer Documentation
- API documentation
- Integration guides
- Network adapter development
- Testing procedures
- Troubleshooting guide

## 14. Compliance & Legal

### 14.1 Regulatory Compliance
- Tax reporting requirements
- Payment regulations
- Advertising standards
- Content guidelines
- Privacy laws (GDPR, CCPA)

### 14.2 Islamic Compliance
- Shariah board consultation
- Halal certification process
- Fatwa documentation
- Scholar endorsements
- Community feedback integration

## 15. Launch Strategy

### 15.1 Phased Rollout
1. **Alpha**: Internal testing with team
2. **Beta**: Select creators (100 users)
3. **Limited Release**: Top 1000 creators
4. **General Availability**: All users

### 15.2 Creator Onboarding
- Monetization webinars
- Setup assistance
- Best practices sharing
- Community forums
- Direct support channel

### 15.3 Network Partnerships
- Identify halal ad networks
- Negotiate agreements
- Technical integration
- Quality assurance
- Performance monitoring

## 16. Risk Mitigation

### 16.1 Technical Risks
- **Risk**: Ad network downtime
  - **Mitigation**: Multiple network fallbacks

- **Risk**: Revenue calculation errors
  - **Mitigation**: Audit logs and reconciliation

- **Risk**: Payment processing failures
  - **Mitigation**: Multiple payment providers

### 16.2 Business Risks
- **Risk**: Low ad fill rates
  - **Mitigation**: Donation alternatives

- **Risk**: Creator dissatisfaction
  - **Mitigation**: Competitive revenue shares

- **Risk**: Compliance violations
  - **Mitigation**: Regular audits and monitoring

### 16.3 Islamic Risks
- **Risk**: Haram ad content slipping through
  - **Mitigation**: Multi-layer filtering and manual review

- **Risk**: Misuse of donation features
  - **Mitigation**: Verification and transparency

- **Risk**: Scholar disapproval
  - **Mitigation**: Regular consultation and adjustment

## Conclusion

The Monetization Controls During Upload feature provides comprehensive monetization options while maintaining Islamic values and compliance. By offering both traditional ad monetization and Islamic alternatives like donations and Sadaqah, the platform can serve diverse creator needs while respecting religious considerations.

The phased implementation approach ensures each component is thoroughly tested and refined before moving to the next phase. Special attention to Islamic compliance, user privacy, and transparent revenue sharing will differentiate this platform in the market.

Success depends on strong partnerships with halal ad networks, verified Islamic charities, and continuous engagement with the Muslim community to ensure the monetization system aligns with both creator needs and Islamic principles.