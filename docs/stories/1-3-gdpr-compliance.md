# Story 1.3: Implement GDPR-Compliant Data Storage

Status: review

## Story

As a EU user,
I want my personal data stored securely with proper encryption,
so that my privacy rights are protected under GDPR regulations.

## Acceptance Criteria

1. Given I am using video player in the EU, when my data is stored locally, then all sensitive data is encrypted before storage
2. Given I am an EU user, when I request my data, then I can access, export, and delete my data
3. Given data processing occurs, when personal data is handled, then data processing is transparent and consent-based
4. Given I visit video player, when cookies or tracking are used, then cookie consent is properly implemented
5. Given user data is stored, when retention policies are checked, then data retention policies are enforced
6. Given GDPR compliance audit is performed, when comprehensive review is conducted, then GDPR compliance audit passes

## Tasks / Subtasks

- [x] Audit existing data storage practices (AC: 1)
  - [x] Identify all localStorage usage in video player (and the rest of the web app: `lib/privacy/local-data.ts` `LOCAL_DATA_INVENTORY`)
  - [x] Document types of data currently stored (`docs/compliance/GDPR.md` §4)
  - [x] Classify data as sensitive vs non-sensitive
  - [x] Assess current encryption implementation. `lib/crypto.ts` was unusable: it depended on the public, unset `NEXT_PUBLIC_ENCRYPTION_SECRET`, used a fresh random salt per page load (data unreadable after reload), had no consumers, and imported the server logger
- [x] Implement AES-256 encryption for local storage (AC: 1)
  - [x] Create EncryptedStorage utility class (`lib/storage/EncryptedStorage.ts`)
  - [x] Key management: a per-device non-extractable AES-GCM-256 WebCrypto key in IndexedDB replaces PBKDF2 from a shipped secret (no secret in the bundle)
  - [x] Data integrity: AES-GCM authentication, with the storage key bound as AAD (replaces a separate HMAC)
  - [x] Replace localStorage calls with encrypted storage for sensitive data (anonymous watch progress). Minimised other keys; removed the never-sent `pendingVideoAnalytics` backup
- [x] Create consent management system (AC: 2, 3, 4)
  - [x] Design consent management UI components (`components/consent/ConsentBanner` LTR + RTL, `ConsentPreferences`)
  - [x] Implement consent state management (`lib/consent/ConsentManager.ts`, `consent-cookie.ts`)
  - [x] Add consent recording and audit trail (`PUT/GET /api/privacy/consent`, profile `privacyConsent`)
  - [x] Integrate with OpenAuth for user consent (decisions recorded against the authenticated user id)
- [x] Implement data access, export, deletion functionality (AC: 2)
  - [x] Create data export API endpoints (`GET /api/privacy/export`, resumable)
  - [x] Implement user data deletion functionality (`DELETE /api/privacy/data`, resumable; processor `UserDataErased` anonymises D1 reports)
  - [x] Add data access verification mechanisms (authenticated caller only; explicit `confirm: "DELETE"`)
  - [x] Create data portability features (JSON download in Settings > Privacy & data)
- [x] Implement transparent consent-based processing (AC: 3)
  - [x] Add consent tracking for all data processing (analytics, experiments, performance gated client- and server-side)
  - [x] Create processing transparency logs (consent changes and privacy operations logged; consent history on profile)
  - [x] Implement consent withdrawal mechanisms (Settings > Privacy & data; purges category data)
  - [x] Add data processing documentation (`docs/compliance/GDPR.md`)
- [x] Implement proper cookie consent implementation (AC: 4)
  - [x] Create cookie consent banner component (bilingual, LTR/RTL)
  - [x] Implement granular consent options
  - [x] Add consent recording and management
  - [x] Integrate with existing authentication system
- [x] Implement data retention policies (AC: 5)
  - [x] Define data retention periods by data type (proposed defaults, pending legal confirmation)
  - [x] Create automated data cleanup processes (api-videos daily cron; browser sweep on load)
  - [x] Add retention policy documentation
  - [x] Implement retention policy enforcement
- [ ] GDPR compliance audit preparation (AC: 6)
  - [x] Conduct GDPR compliance assessment (engineering side, `docs/compliance/GDPR.md` §8)
  - [x] Document all data processing activities
  - [ ] Create data protection impact assessment (legal)
  - [x] Prepare compliance documentation
  - [ ] Schedule third-party GDPR audit (legal)

## Dev Notes

### Project Structure Notes

- **Storage Utilities**: New module in `apps/web/src/lib/storage/`
- **Consent Management**: New components in `apps/web/src/components/consent/`
- **API Integration**: Integration with `apps/api-videos/` for data management
- **Authentication**: Integration with existing OpenAuth system

### Architecture Alignment

- **Encryption Layer**: Client-side encryption following security best practices
- **Consent System**: Integration with existing authentication and user management
- **Data Management**: Following existing repository patterns for data access
- **API Integration**: Using existing Hono API structure for data operations

### Technical Constraints

- **Performance**: Encryption operations must not impact user experience
- **Bundle Size**: Encryption libraries should be optimized for web
- **Browser Support**: Web Crypto API with fallbacks for older browsers
- **Storage Limits**: Respect browser storage limitations

### GDPR Requirements

- **Data Protection by Design**: Privacy built into system architecture
- **User Rights**: Access, rectification, erasure, and portability
- **Consent Management**: Granular, informed, and withdrawable consent
- **Data Minimization**: Collect only necessary data
- **Transparency**: Clear documentation of data processing

### References

- [Source: docs/tech-spec-epic-1.md#Detailed Design - Data Storage Manager]
- [Source: docs/epics-original.md#Story 1.3]
- [Source: docs/PRD.md#Security - Data Protection]
- [Source: apps/web/package.json#Dependencies]

## Dev Agent Record

### Context Reference

- docs/stories/1-3-gdpr-compliance.context.xml

### Agent Model Used

Claude Code (claude-3-5-sonnet-20241022)

### Debug Log References

- api-videos `pnpm test:unit`: 49/49 pass (includes `test/privacy.spec.ts`).
- processor `jest`: 44/44 pass (includes `user-data-erased.test.ts`).
- web jest: no new failures against the `integrate/qa-features` baseline (19 pre-existing failing suites).
- Type-check clean: web, api-videos, processor, admin-api, admin-web (the shared `AppTranslations` gained `privacy`).

### Completion Notes List

Acceptance criteria (2026-11-06, Claude Opus 5.5):

| AC | Status | Evidence |
|---|---|---|
| 1. Sensitive local data encrypted | Met | On-device watch progress is AES-GCM-256 encrypted with a per-device non-extractable key (IndexedDB). It is never written in plaintext; when crypto is unavailable it is kept in memory only. Legacy plaintext is migrated. Tests: `lib/__tests__/crypto.test.ts`, `lib/storage/__tests__/EncryptedStorage.test.ts`, `lib/privacy/__tests__/local-data.test.ts` |
| 2. Access, export, delete | Met | `GET /api/privacy/export`, `DELETE /api/privacy/data` (profiles, channels, videos + media, comments, reactions, watch history, subscriptions, community posts/comments/likes/votes, playlists, templates, reports filed). Settings > Privacy & data UI. Link to the auth account app for the sign-in account. Tests: `apps/api-videos/test/privacy.spec.ts`, `services/api/__tests__/privacy.service.test.ts`, `components/privacySettings/__tests__` |
| 3. Transparent, consent-based processing | Met | Default-deny consent for analytics/experiments/performance, enforced in the services and in the beacon routes (cookie check). Withdrawal purges data. Consent audit trail on the profile. Documentation. Tests: `lib/consent/__tests__/consent.test.ts`, `lib/analytics/__tests__/consent-gating.test.ts`, `services/analytics/__tests__/video-analytics.test.ts` (consent gating), `ab-testing-security.test.ts` |
| 4. Cookie consent implemented | Met | Bilingual banner (LTR/RTL), equal Accept/Reject, granular choices, reopenable. Tests: `components/consent/__tests__/ConsentBanner.test.tsx` |
| 5. Retention enforced | Met (periods pending legal sign-off) | api-videos cron `17 3 * * *`: watch history 18 months, event archive 13 months. Browser: 90-day encrypted progress, 30-minute view markers, consent re-asked after 6 months. Tests: `privacy.spec.ts` (retention), `local-data.test.ts` |
| 6. Audit passes | Prepared, not yet audited | Engineering checklist complete (`docs/compliance/GDPR.md` §8). DPIA, privacy notice wording, records of processing and the third-party audit are legal tasks |

Decisions needed (proposed defaults are implemented):
- Retention periods: watch history 18 months, event archive 13 months, consent 6 months, device progress 90 days.
- Self-service deletion of the auth account (AlUmmahNowAuth has only admin `deleteUser`). Today the page links to the account app.
- Whether account-level watch history needs explicit Art. 9 consent (religious content).
- Whether the bounded-retention pseudonymous event archive may be excluded from on-demand erasure.
- Cloudflare Web Analytics must stay disabled, or be consent-gated (the CSP now blocks it).
- Privacy notice / cookie policy page wording (the banner links to Settings > Privacy & data).

Known follow-ups: Bunny Storage images (avatars, covers, post images) are not deleted on erasure. Cached post like/poll counters refresh on the next like/vote. Adding an R2 lifecycle rule on the message archive as a backstop is recommended.

### File List

- apps/web/src/lib/crypto.ts (rewritten), apps/web/src/lib/storage/EncryptedStorage.ts (new)
- apps/web/src/lib/consent/consent-cookie.ts, ConsentManager.ts (new)
- apps/web/src/lib/privacy/local-data.ts (new)
- apps/web/src/components/consent/ConsentBanner/{index.tsx,rtl/index.tsx,ConsentBannerView.tsx}, ConsentPreferences.tsx (new)
- apps/web/src/components/privacySettings/{index.tsx,rtl/index.tsx,PrivacySettingsView.tsx} (new)
- apps/web/src/app/[locale]/settings/privacy/page.tsx (new), apps/web/src/app/[locale]/settings/page.tsx
- apps/web/src/services/api/privacy.service.ts (new), apps/web/src/services/api/watch-history.ts, apps/web/src/hooks/useWatchProgress.ts
- apps/web/src/services/analytics/video-analytics.ts, services/experiments/{ab-testing,analytics}.ts, services/monitoring/{web-vitals,video-performance}.ts
- apps/web/src/lib/analytics/{client-events,forward-client-events}.ts, apps/web/src/lib/runtime-config.ts, apps/web/src/app/layout.tsx
- apps/web/src/lib/i18n/{types.ts,translations/en.ts,translations/ar.ts}, packages/shared-types/src/{i18n.ts,queue.ts}
- apps/api-videos/src/lib/privacy/{scan,user-data,retention}.ts, src/endpoints/privacy/privacy.ts, src/routers/privacy.router.ts (new)
- apps/api-videos/src/routers/index.ts, src/index.ts (scheduled), src/endpoints/i18n/translationsSync.ts, wrangler.jsonc, wrangler.qa.jsonc
- apps/processor/src/messageProcessor.ts (UserDataErased)
- Tests: apps/api-videos/test/privacy.spec.ts, test/helpers.ts; apps/processor/src/__tests__/user-data-erased.test.ts; web `__tests__` listed above
- docs/compliance/GDPR.md (new)
