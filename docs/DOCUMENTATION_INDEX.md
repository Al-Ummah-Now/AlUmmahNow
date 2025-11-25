# Documentation Index & Reorganization Plan

**Generated**: 2025-11-25
**Purpose**: Track all documentation files, their current location, and recommended actions

## Quick Summary

| Category | Files | Keep | Move | Delete | Merge |
|----------|-------|------|------|--------|-------|
| Root Level | 34 | 2 | 12 | 5 | 15 |
| apps/api-videos | 31 | 10 | 7 | 3 | 11 |
| apps/web | 45+ | 15 | 10 | 15 | 5 |
| docs/ | 50+ | 30 | 5 | 5 | 10 |

---

## Root Level Documentation

### Keep at Root
| File | Reason |
|------|--------|
| `CLAUDE.md` | Essential project guidance for AI assistants |
| `CONTRIBUTING.md` | Standard open source file, expected at root |
| `README.md` | Standard root readme |
| `BEFORE YOU CODE.MD` | Development process guide, critical |

### Move to docs/
| File | Target | Reason |
|------|--------|--------|
| `BACKEND_TESTING_STRATEGY.md` | docs/testing/ | Testing documentation |
| `FILE_LOGGING.md` | docs/guides/ | Developer guide |
| `LOG_MONITORING.md` | docs/guides/ | Developer guide |
| `MODERATION.md` | docs/features/ | Feature documentation |
| `FRONTEND_IMPLEMENTATION_GUIDE.md` | docs/guides/ | Developer guide |
| `IMPLEMENTATION_SUMMARY.md` | docs/archive/implementation/ | Historical |

### Delete (Obsolete)
| File | Reason |
|------|--------|
| `CALENDAR_REMAINING_TASKS.md` | Task tracking file, work completed |

### Merge into Single Document
| Files | Target | Reason |
|-------|--------|--------|
| `CHANNEL_SECTIONS_FINAL_REPORT.md`, `CHANNEL_SECTIONS_IMPLEMENTATION_STATUS.md`, `CHANNEL_SECTIONS_TABS_IMPLEMENTATION_COMPLETE.md`, `CHANNEL_TABS_IMPLEMENTATION_REPORT.md`, `CHANNEL_UPLOAD_FIX.md` | docs/features/channel-sections.md | All related to same feature |
| `E2E_TEST_SUMMARY.md`, `E2E_VIDEO_SEARCH_TEST_PLAN.md`, `E2E_VIDEO_SEARCH_TEST_RESULTS.md` | docs/testing/e2e-test-results.md | All E2E testing docs |
| `LOCALE_MIGRATION_ANALYSIS.md` | Move to docs/archive/migration/ | Migration complete |
| `COMMUNITY_POSTS_IMPLEMENTATION_SUMMARY.md` | docs/features/community-posts.md | Feature doc |
| `COMPREHENSIVE_TEST_ASSESSMENT_REPORT.md` | docs/testing/ | Testing doc |

---

## apps/api-videos Documentation

### Keep in App (App-Specific)
| File | Reason |
|------|--------|
| `CLAUDE.md` | AI assistant guidance specific to API |
| `README.md` | Standard app readme |
| `AUTHENTICATION.md` | API user guide for auth |
| `DEVELOPER_AUTH_GUIDE.md` | Developer guide for auth |
| `ENV_CONFIG.md` | Environment configuration |
| `ERROR_HANDLING.md` | Error handling patterns |
| `LOGGING.md` | Logging patterns |
| `TECHNICAL_DOCUMENTATION.md` | Technical reference |
| `ROADMAP.md` | API development roadmap |

### Move to docs/
| File | Target | Reason |
|------|--------|--------|
| `UPLOAD_ARCHITECTURE.md` | docs/architecture/ | Architecture doc |
| `PERFORMANCE_OPTIMIZATION_PLAN.md` | docs/technical-debt/ | Optimization plan |
| `JWT_SECURITY_AUDIT.md` | docs/reviews/ | Security audit |
| `SECURITY_AUDIT_SUMMARY.md` | docs/reviews/ | Security audit |

### Delete (Obsolete/Duplicate)
| File | Reason |
|------|--------|
| `IMPLEMENTATION_SUMMARY.md` | Superseded by technical docs |
| `RUNTIME-FIX-SUMMARY.md` | One-time fix, completed |
| `.github/copilot-instructions.md` | Duplicate of CLAUDE.md guidance |

### Merge into Single Document
| Files | Target | Reason |
|-------|--------|--------|
| `CHANNEL_SECTIONS_*.md` (8 files) | `CHANNEL_SECTIONS_REFERENCE.md` | Consolidate all channel sections docs |
| `TUS_*.md` (4 files) | `TUS_UPLOAD_REFERENCE.md` | Consolidate all TUS docs |
| `CHANNEL_TABS_*.md` (2 files) | Include in channel sections | Related feature |

---

## apps/web Documentation

### Keep in App (App-Specific)
| File | Reason |
|------|--------|
| `TESTING.md` | App testing guide |
| `SERVER_LOGGING.md` | App logging setup |
| `src/components/*/README.md` | Component documentation |
| `src/lib/i18n/*.md` | i18n system docs |
| `e2e/README.md` | E2E testing guide |

### Move to docs/
| File | Target | Reason |
|------|--------|--------|
| `docs/E2E_TESTING.md` | docs/testing/ | General testing doc |
| `docs/TECHNICAL-FIXES.md` | docs/reviews/ | Technical fixes |
| `docs/hooks/*.md` | docs/guides/ | Hook documentation |
| `docs/components/VideoPlayer/*.md` | docs/features/ | Feature docs |
| `docs/QUOTA_MANAGEMENT_QUICK_START.md` | docs/guides/ | User guide |

### Delete (Migration Complete)
| File | Reason |
|------|--------|
| `ACTUAL_MIGRATION_PATTERNS.md` | Migration complete |
| `CLEANUP_COMPLETE.md` | One-time report |
| `MIGRATION_COMPLETE_SUMMARY.md` | Migration complete |
| `LOCALE_MIGRATION_README.md` | Migration complete |
| `MIGRATION_STRATEGY.md` | Migration complete |
| `e2e/19-dashboard-videos-ownership*.md` (6 files) | Test execution docs, tests now automated |

### Merge
| Files | Target | Reason |
|-------|--------|--------|
| `TEST_SUMMARY.md`, `E2E_TEST_SUITE_SUMMARY.md`, `CALENDAR_TEST_SUMMARY.md` | `TESTING.md` | Consolidate test summaries |
| `CHANNEL_TESTS_REPORT.md`, `CHANNEL_UPLOAD_401_FIX.md` | Include in channel docs | Related to channels |

---

## docs/ Folder Reorganization

### Current Structure Issues
1. **ADRs in 3 locations**: `/docs/adr/`, `/docs/ADR-*.md`, `/docs/architecture/`
2. **Legacy folders**: `/docs/legacy/`, `/docs/migration/` contain outdated content
3. **Report files**: JSON/YAML files mixed with markdown
4. **Live streaming**: Complex nested structure, some archived

### Target Structure
```
docs/
├── README.md                 # Main documentation index
├── DOCUMENTATION_INDEX.md    # This file - tracks all docs
├── adr/                      # All Architecture Decision Records
│   ├── 0001-channel-settings-refactor.md
│   ├── 0002-video-sections.md
│   ├── 0003-r2-storage.md
│   ├── 0004-authentication.md
│   ├── 0005-d1-database-integration.md
│   └── 0006-metrics-and-cost-estimation.md
├── architecture/             # System architecture docs
│   ├── architecture.md
│   ├── integration-architecture.md
│   └── architecture-improvement-plan.md
├── features/                 # Feature documentation
│   ├── channel-sections.md
│   ├── community-posts.md
│   ├── live-streaming.md
│   ├── video-upload.md
│   └── youtube-comparison.md
├── guides/                   # Developer guides
│   ├── development-guide.md
│   ├── deployment-guide.md
│   ├── logging-guide.md
│   └── quota-management.md
├── research/                 # Research documents
│   ├── README.md
│   ├── admin-app-specification.md
│   ├── analytics-dashboard-architecture.md
│   ├── infrastructure-orchestration.md
│   ├── subscription-system-schema.md
│   ├── transcription-and-search-architecture.md
│   └── video-hosting-alternatives.md
├── reviews/                  # Code reviews and audits
│   ├── security-audits/
│   └── performance-reviews/
├── testing/                  # Testing documentation
│   ├── test-strategy.md
│   ├── e2e-testing.md
│   └── test-cases/
├── technical-debt/           # Technical debt tracking
├── stories/                  # User stories
├── reports/                  # JSON/YAML reports (moved from root docs)
│   ├── exhaustive-scan-report.json
│   ├── project-scan-report.json
│   └── sprint-status.yaml
└── archive/                  # Historical documentation
    ├── live-streaming-old/
    ├── migration/
    └── legacy/
```

### ADR Consolidation
| Current Location | Target | Notes |
|-----------------|--------|-------|
| `docs/ADR-001-channel-settings-refactor.md` | `docs/adr/0001-channel-settings-refactor.md` | Rename to standard format |
| `docs/ADR-002-video-sections.md` | `docs/adr/0002-video-sections.md` | Rename |
| `docs/adr/0003-r2-storage.md` | Keep | Already correct |
| `docs/adr/0004-authentication.md` | Keep | Already correct |
| `docs/adr/0005-d1-database-integration.md` | Keep | Already correct |
| `docs/adr/0006-metrics-and-cost-estimation.md` | Keep | Already correct |

### Files to Archive
| File/Folder | Reason |
|-------------|--------|
| `docs/legacy/` | Historical, rarely accessed |
| `docs/migration/` | Migration complete |
| `docs/archive/live-streaming-old/` | Already archived |
| `docs/epics-original.md` | Superseded by epics.md |

### Files to Delete
| File | Reason |
|------|--------|
| `docs/documentation-validation.md` | One-time validation report |
| `docs/workflow-completion-summary.md` | One-time summary |
| `docs/github-activity-analysis.md` | Historical analysis |
| `docs/implementation-readiness-report-*.md` | Dated reports |

---

## Execution Plan

### Phase 1: Create Folder Structure
```bash
mkdir -p docs/reports
mkdir -p docs/testing/test-cases
mkdir -p docs/reviews/security-audits
mkdir -p docs/reviews/performance-reviews
```

### Phase 2: Consolidate ADRs
1. Move `docs/ADR-001-*.md` to `docs/adr/0001-*.md`
2. Move `docs/ADR-002-*.md` to `docs/adr/0002-*.md`
3. Update any cross-references

### Phase 3: Move Files
1. Move root-level docs to appropriate folders
2. Move app-level docs to docs/ where appropriate
3. Move JSON/YAML reports to docs/reports/

### Phase 4: Merge Documents
1. Merge CHANNEL_SECTIONS_* files
2. Merge TUS_* files
3. Merge E2E test docs

### Phase 5: Delete Obsolete
1. Delete migration-complete docs
2. Delete one-time reports
3. Clean up empty folders

### Phase 6: Update Index
1. Update docs/README.md with new structure
2. Update cross-references in CLAUDE.md
3. Verify all links work

---

## Tracking: Planned Features Not Yet Implemented

Based on documentation analysis, these features are documented but may not be implemented:

| Feature | Documentation | Status |
|---------|--------------|--------|
| Admin App | docs/research/admin-app-specification.md | PLANNED |
| RunPod Integration | docs/research/infrastructure-orchestration.md | PLANNED |
| Hetzner Integration | docs/research/infrastructure-orchestration.md | PLANNED |
| Transcription Pipeline | docs/research/transcription-and-search-architecture.md | PLANNED |
| AI Search (Vectorize) | docs/research/transcription-and-search-architecture.md | PLANNED |
| Subscription System | docs/research/subscription-system-schema.md | PLANNED |
| Cost Dashboard | docs/research/analytics-dashboard-architecture.md | PLANNED |
| Live Streaming Phase 3-4 | docs/live-streaming/ | PARTIAL |

---

## Notes

- **Newer overrides older**: When merging, use git commit dates to determine which content takes precedence
- **Preserve history**: Use git mv for moves to preserve file history
- **Cross-references**: After reorganization, update all internal links
- **CLAUDE.md**: Must be updated to reflect new documentation structure
