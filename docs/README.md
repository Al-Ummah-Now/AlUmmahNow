# Documentation

This directory contains detailed documentation for the Al Ummah Now monorepo.

## Documentation Structure

### Root Level
- **[../README.md](../README.md)** - Main project README with quick start
- **[../CLAUDE.md](../CLAUDE.md)** - AI assistant guidance for monorepo development
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** - Development guidelines and standards

### App-Specific Documentation

#### Web App (Frontend)
- **[../.github/CLAUDE.md](../.github/CLAUDE.md)** - Frontend development guide (legacy, mostly accurate)
- **[../.github/copilot-instructions.md](../.github/copilot-instructions.md)** - GitHub Copilot guidance

#### API Videos (Backend)
- **[../apps/api-videos/CLAUDE.md](../apps/api-videos/CLAUDE.md)** - Complete API development guide
- **[../apps/api-videos/README.md](../apps/api-videos/README.md)** - API quick start
- **[../apps/api-videos/AUTHENTICATION.md](../apps/api-videos/AUTHENTICATION.md)** - API user authentication guide
- **[../apps/api-videos/DEVELOPER_AUTH_GUIDE.md](../apps/api-videos/DEVELOPER_AUTH_GUIDE.md)** - Adding auth to endpoints
- **[../apps/api-videos/TECHNICAL_DOCUMENTATION.md](../apps/api-videos/TECHNICAL_DOCUMENTATION.md)** - Complete API reference
- **[../apps/api-videos/ROADMAP.md](../apps/api-videos/ROADMAP.md)** - API development roadmap

#### Processor (Queue Consumer)
- **[../apps/processor/README.md](../apps/processor/README.md)** - Processor documentation

### Legacy Documentation (`legacy/`)

Pre-monorepo documentation preserved for historical reference:

- **[ARCHITECTURE.md](legacy/ARCHITECTURE.md)** - Original architecture (single-app structure)
- **[DEPLOYMENT.md](legacy/DEPLOYMENT.md)** - Original deployment guide
- **[FEATURES.md](legacy/FEATURES.md)** - Feature implementation status (pre-monorepo)
- **[ROADMAP.md](legacy/ROADMAP.md)** - Original 4-phase roadmap
- **[ACTION_PLAN.md](legacy/ACTION_PLAN.md)** - Historical action plan
- **[ANALYTICS_ARCHITECTURE.md](legacy/ANALYTICS_ARCHITECTURE.md)** - Analytics architecture
- **[GITHUB_ISSUES.md](legacy/GITHUB_ISSUES.md)** - Issue planning templates
- **[IMPLEMENTATION_ISSUES.md](legacy/IMPLEMENTATION_ISSUES.md)** - Planned implementation issues
- **[ISSUE_TEMPLATES.md](legacy/ISSUE_TEMPLATES.md)** - Multi-repository issue templates
- **[NEXT_STEPS.md](legacy/NEXT_STEPS.md)** - Historical next steps

**Note**: Legacy docs may reference outdated architecture (npm instead of pnpm, single app instead of monorepo, Fastify instead of Hono). For current information, refer to root-level and app-specific documentation.

### Migration Documentation (`migration/`)

Documentation related to the monorepo migration:

- **[MONOREPO_MIGRATION.md](migration/MONOREPO_MIGRATION.md)** - Complete migration strategy
- **[MONOREPO_SETUP_GUIDE.md](migration/MONOREPO_SETUP_GUIDE.md)** - Step-by-step migration guide
- **[MONOREPO_READY.md](migration/MONOREPO_READY.md)** - Migration completion summary

## Getting Started

1. **New developers**: Start with [../README.md](../README.md)
2. **AI assistants**: Read [../CLAUDE.md](../CLAUDE.md)
3. **Frontend work**: See [../.github/CLAUDE.md](../.github/CLAUDE.md)
4. **API development**: Read [../apps/api-videos/CLAUDE.md](../apps/api-videos/CLAUDE.md)
5. **Processor work**: Check [../apps/processor/README.md](../apps/processor/README.md)

## Contributing to Documentation

When adding or updating documentation:

1. **Root README** - Keep it concise with quick start instructions
2. **CLAUDE.md** - Focus on monorepo-wide development guidance
3. **App-specific docs** - Keep detailed technical info in app directories
4. **Legacy docs** - Don't update; create new docs instead
5. **Migration docs** - Historical record only

## Documentation Updates

After major changes, update:
- Root README.md for user-facing changes
- CLAUDE.md for development workflow changes
- App-specific docs for feature additions
- CI/CD workflow comments for pipeline changes
