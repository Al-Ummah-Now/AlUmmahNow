# Deployment Guide - Al Ummah Now

## Overview

Al Ummah Now uses GitHub Actions for automated CI/CD deployment to Cloudflare Workers with integrated Bunny.net media storage. This guide covers the complete deployment architecture, environment variables, and operational procedures.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   GitHub Repo   │───▶│  GitHub Actions │───▶│ Cloudflare Edge │
│   (Source)      │    │   (CI/CD)       │    │   (Workers)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                 │
                                 ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Build & Test  │───▶│   Bunny.net     │
                       │   (Automated)   │    │ (Media Storage) │
                       └─────────────────┘    └─────────────────┘
```

## Deployment Pipeline

The deployment pipeline consists of 5 stages:

### 1. Test Stage
- **Trigger**: Push to `main` branch or Pull Request
- **Actions**:
  - Install dependencies (`npm ci`)
  - TypeScript type checking (`npx tsc --noEmit`)
  - Code linting (`npm run lint`)
  - Security audit (`npm audit`)

### 2. Build Stage
- **Trigger**: After successful test stage
- **Actions**:
  - Install dependencies
  - Build application (`npm run build`)
  - Upload build artifacts (`.open-next/`, configs)
- **Artifacts**: Stored for 30 days

### 3. Preview Deployment (Pull Requests Only)
- **Trigger**: Pull Request creation or updates
- **Environment**: `preview`
- **Worker Name**: `al-ummah-now-pr-{PR_NUMBER}`
- **Configuration**: `wrangler.preview.jsonc`
- **Resources**:
  - Bunny.net zones: `al-ummah-now-images-preview`, `videos-preview`
  - R2 bucket: `videos-preview`
- **Features**:
  - Automatic PR comment with preview URL
  - Dynamic worker naming per PR
  - Automatic cleanup when PR is closed
  - Isolated preview environment

### 4. Staging Deployment
- **Trigger**: Push to `main` branch (after successful build)
- **Environment**: `staging`
- **Worker Name**: `al-ummah-now-staging`
- **Configuration**: `wrangler.staging.jsonc`
- **Resources**:
  - Bunny.net zones: `al-ummah-now-images-staging`, `videos-staging`
  - R2 bucket: `videos-staging`

### 5. Production Deployment
- **Trigger**: After successful staging deployment
- **Environment**: `production`
- **Worker Name**: `al-ummah-now-production`
- **Configuration**: `wrangler.production.jsonc`
- **Resources**:
  - Bunny.net zones: `al-ummah-now-images`, `videos-mostafa-elbadry`
  - R2 bucket: `videos`

## Required Secrets & Environment Variables

### GitHub Secrets (Required)
Set these in your GitHub repository settings (`Settings > Secrets and Variables > Actions`):

```bash
CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>
```

**How to obtain Cloudflare API Token**:
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Create Token with permissions:
   - Account: `Cloudflare Workers:Edit`
   - Zone Resources: `Include All zones`
   - Account Resources: `Include All accounts`

### Environment Variables (Per Environment)

#### Development (wrangler.jsonc)
```json
{
  "vars": {
    "Issuer": "https://auth.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.alummahnow.net",
    "NEXTJS_ENV": "development",
    "API_URL": "https://videos.api.alummahnow.net"
  },
  "env": {
    "BunnyImageZone": "al-ummah-now-images",
    "BunnyVideoZone": "videos-mostafa-elbadry"
  }
}
```

#### Preview (wrangler.preview.jsonc)
```json
{
  "vars": {
    "Issuer": "https://auth.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.alummahnow.net",
    "NEXTJS_ENV": "preview",
    "API_URL": "https://videos.api.alummahnow.net"
  },
  "env": {
    "BunnyImageZone": "al-ummah-now-images-preview",
    "BunnyVideoZone": "videos-preview"
  }
}
```

#### Staging (wrangler.staging.jsonc)
```json
{
  "vars": {
    "Issuer": "https://auth.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.alummahnow.net",
    "NEXTJS_ENV": "staging",
    "API_URL": "https://videos.api.alummahnow.net"
  },
  "env": {
    "BunnyImageZone": "al-ummah-now-images-staging",
    "BunnyVideoZone": "videos-staging"
  }
}
```

#### Production (wrangler.production.jsonc)
```json
{
  "vars": {
    "Issuer": "https://auth.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.alummahnow.net",
    "NEXTJS_ENV": "production",
    "API_URL": "https://videos.api.alummahnow.net"
  },
  "env": {
    "BunnyImageZone": "al-ummah-now-images",
    "BunnyVideoZone": "videos-mostafa-elbadry"
  }
}
```

### Sensitive Environment Variables

The following variables need to be set in Cloudflare Workers dashboard as encrypted environment variables:

- `BunnyImageKey`: Bunny.net API key for image storage
- `BunnyVideoKey`: Bunny.net API key for video storage
- `S3Key`: Cloudflare R2 access key
- `S3Secret`: Cloudflare R2 secret key
- `S3Token`: Cloudflare R2 token

## Bunny.net Integration

### Storage Zones Configuration

#### Development/Production
- **Image Zone**: `al-ummah-now-images`
- **Video Zone**: `videos-mostafa-elbadry`
- **CDN**: Global edge delivery
- **Security**: API key authentication

#### Staging
- **Image Zone**: `al-ummah-now-images-staging`
- **Video Zone**: `videos-staging`
- **CDN**: Global edge delivery
- **Security**: API key authentication

#### Preview (Pull Requests)
- **Image Zone**: `al-ummah-now-images-preview`
- **Video Zone**: `videos-preview`
- **CDN**: Global edge delivery
- **Security**: API key authentication
- **Isolation**: Separate resources for PR testing

### R2 Bucket Configuration

- **Production**: `videos` bucket
- **Staging**: `videos-staging` bucket
- **Preview**: `videos-preview` bucket
- **Binding**: Accessible as `env.videos` in Workers
- **CORS**: Configured for web uploads

## Deployment Commands

### Manual Deployment

```bash
# Deploy to preview environment
npm run deploy:preview           # Deploy to preview worker

# Deploy to staging
npm run deploy:staging          # Deploy to staging environment

# Deploy to production  
npm run deploy:production       # Deploy to production environment

# Preview deployments locally
npm run preview                 # Preview development build
npm run preview:staging         # Preview staging configuration
npm run preview:local           # Preview with preview configuration
```

### Development

```bash
# Start development server
npm run dev

# Check deployment readiness
npm run check

# Generate types after config changes
npm run cf-typegen
```

### Preview Deployments

Preview deployments are automatically created for pull requests using Cloudflare Workers preview functionality:

```bash
# Manual preview deployment with custom name
npx wrangler deploy --config wrangler.preview.jsonc --name al-ummah-now-pr-123

# View preview logs
npm run logs:preview

# Clean up preview deployment
npx wrangler delete al-ummah-now-pr-123
```

**Preview Features**:
- Automatic deployment on PR creation/update
- Dynamic worker naming: `al-ummah-now-pr-{PR_NUMBER}`
- PR comments with preview URLs
- Automatic cleanup when PR is closed
- Isolated preview resources (separate Bunny.net zones and R2 buckets)

## Monitoring & Observability

### Enabled Features
- **Cloudflare Analytics**: Real-time performance metrics
- **Source Maps**: Error tracking and debugging
- **Logpush**: Centralized logging
- **Observability**: Request tracing and monitoring

### Key Metrics to Monitor
- Request latency (target: < 200ms)
- Error rate (target: < 0.1%)
- Cache hit ratio (target: > 95%)
- Video upload success rate
- Authentication flow completion

## Rollback Procedures

### Automated Rollback
If a deployment fails, the GitHub Actions workflow will stop and not proceed to the next stage.

### Manual Rollback

```bash
# List recent deployments
npx wrangler deployments list

# Rollback to specific deployment
npx wrangler rollback [deployment-id]

# Rollback staging
npx wrangler rollback --config wrangler.staging.jsonc [deployment-id]

# Rollback production
npx wrangler rollback --config wrangler.production.jsonc [deployment-id]
```

### Emergency Procedures

1. **Immediate Issues**: Use Cloudflare Workers dashboard to disable the worker
2. **Rollback**: Use `wrangler rollback` to previous working deployment
3. **Hotfix**: Create hotfix branch, test, and deploy directly
4. **Communication**: Update status page and notify team

## Security Considerations

### API Keys & Secrets
- All sensitive data stored as encrypted environment variables
- API tokens use minimal required permissions
- Regular rotation of access keys (monthly)

### Deployment Security
- Only `main` branch can deploy to production
- Required environments protection rules
- Audit trail via GitHub Actions logs

### Content Security
- Bunny.net zones configured with appropriate access controls
- R2 buckets use CORS policies
- Authentication required for all admin operations

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check TypeScript errors
npx tsc --noEmit

# Fix linting issues
npm run lint --fix

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Deployment Failures
```bash
# Check Wrangler configuration
npx wrangler whoami

# Validate config syntax
npx wrangler deploy --dry-run

# Check logs
npx wrangler tail
```

#### Environment Variable Issues
```bash
# List current variables
npx wrangler secret list

# Update variable
npx wrangler secret put VARIABLE_NAME

# Regenerate types
npm run cf-typegen
```

### Support Contacts
- **Technical Issues**: GitHub Issues
- **Infrastructure**: Cloudflare Support
- **Media Storage**: Bunny.net Support

## Performance Targets

### Deployment Speed
- **Test Stage**: < 2 minutes
- **Build Stage**: < 5 minutes
- **Staging Deploy**: < 3 minutes
- **Production Deploy**: < 3 minutes
- **Total Pipeline**: < 13 minutes

### Application Performance
- **First Contentful Paint**: < 1.5s
- **Largest Contentful Paint**: < 2.5s
- **Time to Interactive**: < 3.5s
- **Cumulative Layout Shift**: < 0.1

### Uptime Targets
- **Production**: 99.9% uptime SLA
- **Staging**: 99.5% uptime SLA
- **Recovery Time**: < 15 minutes