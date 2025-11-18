# Al Ummah Now Web App Documentation

This directory contains all documentation for the Al Ummah Now web application.

## Table of Contents

### Architecture & Design Decisions
- [ADR-001: Multi-Account Multi-Channel](./ADR-001-multi-account-multi-channel.md) - Architecture decision record for multi-account support
- [MIGRATION-GUIDE: Multi-Account](./MIGRATION-GUIDE-multi-account.md) - Migration guide for multi-account feature
- [COOKIE-SIZE-MONITORING](./COOKIE-SIZE-MONITORING.md) - Cookie size monitoring implementation

### Components

#### Video Player
- [README](./components/VideoPlayer/README.md) - Video player overview
- [ACCESSIBILITY](./components/VideoPlayer/ACCESSIBILITY.md) - Accessibility features
- [FOCUS_FLOW](./components/VideoPlayer/FOCUS_FLOW.md) - Focus management
- [I18N_ARCHITECTURE](./components/VideoPlayer/I18N_ARCHITECTURE.md) - Internationalization architecture
- [I18N_DESIGN](./components/VideoPlayer/I18N_DESIGN.md) - I18N design patterns
- [I18N_IMPLEMENTATION_EXAMPLE](./components/VideoPlayer/I18N_IMPLEMENTATION_EXAMPLE.md) - I18N examples
- [I18N_QUICK_START](./components/VideoPlayer/I18N_QUICK_START.md) - I18N quick start guide
- [I18N_README](./components/VideoPlayer/I18N_README.md) - I18N overview
- [IMPLEMENTATION_SUMMARY](./components/VideoPlayer/IMPLEMENTATION_SUMMARY.md) - Implementation summary
- [MIGRATION_GUIDE](./components/VideoPlayer/MIGRATION_GUIDE.md) - Migration guide
- [RESUME_INTEGRATION](./components/VideoPlayer/RESUME_INTEGRATION.md) - Resume playback integration
- [RESUME_PROMPT_README](./components/VideoPlayer/RESUME_PROMPT_README.md) - Resume prompt feature
- [VIDEO_PLAYER_CONTROLS_RESEARCH](./VIDEO_PLAYER_CONTROLS_RESEARCH.md) - Controls research

#### Live Streaming
- [StreamStatusBadge README](./components/live-streaming/README.md) - Stream status badge component

### Services

#### Bunny CDN
- [README](./services/bunny/README.md) - Bunny CDN integration overview
- [IMPLEMENTATION_SUMMARY](./services/bunny/IMPLEMENTATION_SUMMARY.md) - Implementation details

#### Analytics
- [README](./services/analytics/README.md) - Analytics service documentation

#### Experiments
- [SECURITY_IMPROVEMENTS](./services/experiments/SECURITY_IMPROVEMENTS.md) - Security improvements

### Libraries & Utilities

#### API Client
- [README](./lib/api/README.md) - API client documentation

#### Utils
- [STORAGE_QUOTA_MANAGEMENT](./lib/utils/STORAGE_QUOTA_MANAGEMENT.md) - Storage quota management
- [QUOTA_MANAGEMENT](./QUOTA_MANAGEMENT.md) - Quota management overview
- [QUOTA_MANAGEMENT_QUICK_START](./QUOTA_MANAGEMENT_QUICK_START.md) - Quick start guide

### Hooks
- [useWatchProgress Demo](./hooks/useWatchProgress-demo.md) - Watch progress hook demo

### Testing
- [TESTING](./TESTING.md) - Testing overview
- [E2E_TESTING](./E2E_TESTING.md) - End-to-end testing
- [e2e/README](./e2e/README.md) - E2E test setup

### Public Assets
- [AI README](./public/ai/README.md) - AI-related public assets

### Implementation Guides
- [IMPLEMENTATION_SUMMARY](./IMPLEMENTATION_SUMMARY.md) - General implementation summary
- [PHASE_2_3_INTEGRATION_GUIDE](./PHASE_2_3_INTEGRATION_GUIDE.md) - Phase 2 & 3 integration
- [PHASE_3_INTEGRATION_GUIDE](./PHASE_3_INTEGRATION_GUIDE.md) - Phase 3 integration

### Bug Fixes & Technical Notes
- [AUTHENTICATION_FIX](./AUTHENTICATION_FIX.md) - Authentication fixes
- [FOCUS_TRAP_IMPLEMENTATION](./FOCUS_TRAP_IMPLEMENTATION.md) - Focus trap implementation
- [INFINITE_LOOP_FIX](./INFINITE_LOOP_FIX.md) - Infinite loop fixes
- [MEMORY_LEAK_FIX](./MEMORY_LEAK_FIX.md) - Memory leak fixes
- [quality-selector-fix-report](./quality-selector-fix-report.md) - Quality selector fixes
- [TECHNICAL-FIXES](./TECHNICAL-FIXES.md) - Technical fixes
- [VIDEO_ACCESSIBILITY](./VIDEO_ACCESSIBILITY.md) - Video accessibility

## Contributing

When adding new documentation:

1. Place it in the appropriate subdirectory based on the feature area
2. Update this README with a link to your new document
3. Use clear, descriptive filenames
4. Follow existing documentation patterns

## Documentation Standards

- Use Markdown format
- Include code examples where applicable
- Keep documentation up-to-date with code changes
- Use relative links when referencing other docs
