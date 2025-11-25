# Documentation

This directory contains detailed documentation for the Al Ummah Now monorepo.

> **Master Index**: See [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) for complete tracking of all documentation files, their status, and planned changes.

## Documentation Structure

```
docs/
├── README.md                     # This file
├── DOCUMENTATION_INDEX.md        # Master index with reorganization tracking
├── adr/                          # Architecture Decision Records (ADRs)
│   ├── 0001-channel-settings-refactor.md
│   ├── 0002-video-sections.md
│   ├── 0003-r2-storage.md
│   ├── 0004-authentication.md
│   ├── 0005-d1-database-integration.md
│   └── 0006-metrics-and-cost-estimation.md
├── architecture/                 # System architecture docs
│   ├── architecture.md           # High-level system architecture
│   ├── integration-architecture.md
│   └── UPLOAD_ARCHITECTURE.md
├── features/                     # Feature documentation
│   ├── channel-sections-implementation.md  # Consolidated channel sections docs
│   ├── community-posts.md
│   ├── MODERATION.md
│   └── YOUTUBE_FEATURE_COMPARISON.md
├── guides/                       # Developer guides
│   ├── development-guide.md
│   ├── deployment-guide.md
│   ├── FILE_LOGGING.md
│   ├── FRONTEND_IMPLEMENTATION_GUIDE.md
│   └── LOG_MONITORING.md
├── research/                     # Research documents (planned features)
│   ├── README.md
│   ├── admin-app-specification.md
│   ├── analytics-dashboard-architecture.md
│   ├── infrastructure-orchestration.md
│   ├── subscription-system-schema.md
│   ├── transcription-and-search-architecture.md
│   └── video-hosting-alternatives.md
├── reviews/                      # Code reviews and security audits
│   ├── security-audits/
│   │   ├── JWT_SECURITY_AUDIT.md
│   │   └── SECURITY_AUDIT_SUMMARY.md
│   └── performance-reviews/
├── testing/                      # Testing documentation
│   ├── BACKEND_TESTING_STRATEGY.md
│   ├── COMPREHENSIVE_TEST_ASSESSMENT_REPORT.md
│   ├── e2e-test-results.md       # Consolidated E2E test docs
│   └── test-cases/
├── technical-debt/               # Technical debt tracking
│   ├── PERFORMANCE_OPTIMIZATION_PLAN.md
│   └── video-upload.md
├── reports/                      # JSON/YAML reports
│   ├── exhaustive-scan-report.json
│   ├── project-scan-report.json
│   └── sprint-status.yaml
├── stories/                      # User stories
├── live-streaming/               # Live streaming feature docs
└── archive/                      # Historical documentation
    ├── documentation-validation.md
    ├── epics-original.md
    ├── github-activity-analysis.md
    ├── implementation/
    ├── implementation-readiness-report-2025-11-05.md
    ├── live-streaming-old/
    ├── migration/
    ├── migration-completed/
    ├── PRD_ENHANCEMENT_ANALYSIS.md
    └── workflow-completion-summary.md
```

## Quick Navigation

### Getting Started
| Document | Description |
|----------|-------------|
| [../README.md](../README.md) | Main project README with quick start |
| [../CLAUDE.md](../CLAUDE.md) | AI assistant guidance for monorepo |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development guidelines and standards |
| [guides/development-guide.md](guides/development-guide.md) | Developer setup guide |

### Architecture
| Document | Description |
|----------|-------------|
| [architecture/architecture.md](architecture/architecture.md) | System architecture overview |
| [adr/](adr/) | Architecture Decision Records |
| [research/](research/) | Research docs for planned features |

### Features
| Document | Description |
|----------|-------------|
| [features/channel-sections-implementation.md](features/channel-sections-implementation.md) | Channel sections & tabs feature |
| [features/community-posts.md](features/community-posts.md) | Community posts feature |
| [PRD.md](PRD.md) | Product Requirements Document |

### App-Specific Documentation

#### Web App (Frontend)
| Document | Description |
|----------|-------------|
| [../.github/CLAUDE.md](../.github/CLAUDE.md) | Frontend development guide |
| [../apps/web/TESTING.md](../apps/web/TESTING.md) | Web app testing guide |

#### API Videos (Backend)
| Document | Description |
|----------|-------------|
| [../apps/api-videos/CLAUDE.md](../apps/api-videos/CLAUDE.md) | Complete API development guide |
| [../apps/api-videos/CHANNEL_REFERENCE.md](../apps/api-videos/CHANNEL_REFERENCE.md) | Channel API reference |
| [../apps/api-videos/TUS_REFERENCE.md](../apps/api-videos/TUS_REFERENCE.md) | TUS upload reference |
| [../apps/api-videos/AUTHENTICATION.md](../apps/api-videos/AUTHENTICATION.md) | API authentication guide |

#### Processor (Queue Consumer)
| Document | Description |
|----------|-------------|
| [../apps/processor/README.md](../apps/processor/README.md) | Processor documentation |

#### WebSocket Server
| Document | Description |
|----------|-------------|
| [../apps/websocket-server/README.md](../apps/websocket-server/README.md) | WebSocket server docs |

## Planned Features (Research)

These features are documented but not yet implemented:

| Feature | Document | Status |
|---------|----------|--------|
| Admin App | [research/admin-app-specification.md](research/admin-app-specification.md) | PLANNED |
| RunPod Integration | [research/infrastructure-orchestration.md](research/infrastructure-orchestration.md) | PLANNED |
| Hetzner Integration | [research/infrastructure-orchestration.md](research/infrastructure-orchestration.md) | PLANNED |
| Transcription Pipeline | [research/transcription-and-search-architecture.md](research/transcription-and-search-architecture.md) | PLANNED |
| AI Search (Vectorize) | [research/transcription-and-search-architecture.md](research/transcription-and-search-architecture.md) | PLANNED |
| Subscription System | [research/subscription-system-schema.md](research/subscription-system-schema.md) | PLANNED |
| Cost Dashboard | [research/analytics-dashboard-architecture.md](research/analytics-dashboard-architecture.md) | PLANNED |

## ADR (Architecture Decision Records)

| ADR | Title | Status |
|-----|-------|--------|
| [0001](adr/0001-channel-settings-refactor.md) | Channel Settings Refactor | Accepted |
| [0002](adr/0002-video-sections.md) | Video Sections | Accepted |
| [0003](adr/0003-r2-storage.md) | R2 Storage | Accepted |
| [0004](adr/0004-authentication.md) | Authentication | Accepted |
| [0005](adr/0005-d1-database-integration.md) | D1 Database Integration | Accepted |
| [0006](adr/0006-metrics-and-cost-estimation.md) | Metrics and Cost Estimation | Accepted |

## Contributing to Documentation

### Guidelines

1. **Use existing structure** - Place docs in appropriate folders
2. **Update index** - Add new docs to [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)
3. **No duplication** - Check existing docs before creating new ones
4. **Merge related docs** - Consolidate overlapping content
5. **Archive obsolete** - Move outdated docs to `archive/`

### File Naming

- Use `kebab-case` for filenames: `my-feature-guide.md`
- Use `SCREAMING_SNAKE_CASE` for reports: `TEST_RESULTS.md`
- ADRs use numbered format: `0001-decision-title.md`

### Content Guidelines

- Start with a title and date
- Include a "Last Updated" date if content changes frequently
- Link to related documents
- Include code examples where applicable
- Mark planned features with status badges

## Legacy Documentation

Historical documentation is preserved in `archive/` for reference:

- `legacy/` - Pre-monorepo architecture docs
- `migration/` - Monorepo migration docs
- `migration-completed/` - Completed migration reports
- `live-streaming-old/` - Superseded live streaming docs

**Note**: Legacy docs may reference outdated architecture. For current information, use app-specific documentation.
