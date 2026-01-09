# Admin Dashboard App Specification

**Document Version**: 1.0
**Status**: Draft
**Author**: System Architect
**Date**: 2025-01-25
**Related**: [Analytics Dashboard Architecture](./analytics-dashboard-architecture.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Directory Structure](#2-directory-structure)
3. [Package Configuration](#3-package-configuration)
4. [Wrangler Configuration](#4-wrangler-configuration)
5. [Tech Stack Decisions](#5-tech-stack-decisions)
6. [Authentication Architecture](#6-authentication-architecture)
7. [Routes and Pages](#7-routes-and-pages)
8. [API Routes](#8-api-routes)
9. [D1 Database Bindings](#9-d1-database-bindings)
10. [KV Bindings](#10-kv-bindings)
11. [Integration with api-videos](#11-integration-with-api-videos)
12. [Real-Time Updates Strategy](#12-real-time-updates-strategy)
13. [UI/UX Requirements](#13-uiux-requirements)
14. [Security Considerations](#14-security-considerations)
15. [Deployment Strategy](#15-deployment-strategy)
16. [Implementation Phases](#16-implementation-phases)

---

## 1. Executive Summary

### Purpose

The Admin Dashboard is a **separate internal application** for platform administrators to:
- Monitor real-time costs and system health
- Manage system-wide feature toggles
- Review and manage users, channels, and content
- Monitor job queues and dead letter queue
- View subscription analytics and revenue metrics
- Control infrastructure (RunPod jobs, queues, circuit breakers)

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Framework** | Next.js 15 + React 19 | Consistency with web app, SSR for dashboard, familiar patterns |
| **Authentication** | Separate admin auth (not OpenAuth) | Isolate admin access from user auth system |
| **Deployment** | Cloudflare Workers via OpenNext | Same deployment pattern as web app |
| **Database** | D1 for admin data | Structured queries needed for analytics |
| **Real-time** | Polling (30s) + Manual refresh | Simpler than WebSocket for admin use case |
| **UI Framework** | Tailwind CSS + shadcn/ui | Consistency with web app |

### Why Separate from Web App

1. **Security Isolation**: Admin functions must not be accidentally exposed to users
2. **Different Authentication**: Admins need MFA, IP restrictions, audit logs
3. **Different Deployment**: Can deploy admin separately without affecting users
4. **Simpler Access Control**: No complex RBAC needed in web app
5. **Resource Isolation**: Admin queries don't impact user-facing performance

---

## 2. Directory Structure

```
apps/admin/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout with admin nav
│   │   ├── page.tsx                      # Dashboard overview
│   │   ├── globals.css                   # Global styles
│   │   │
│   │   ├── (auth)/                       # Auth routes (public)
│   │   │   ├── login/
│   │   │   │   └── page.tsx              # Admin login page
│   │   │   ├── logout/
│   │   │   │   └── page.tsx              # Logout handler
│   │   │   └── layout.tsx                # Auth layout (minimal)
│   │   │
│   │   ├── (dashboard)/                  # Protected dashboard routes
│   │   │   ├── layout.tsx                # Dashboard layout with sidebar
│   │   │   │
│   │   │   ├── costs/
│   │   │   │   ├── page.tsx              # Real-time cost dashboard
│   │   │   │   ├── breakdown/
│   │   │   │   │   └── page.tsx          # Detailed cost breakdown
│   │   │   │   └── forecast/
│   │   │   │       └── page.tsx          # Cost projections
│   │   │   │
│   │   │   ├── toggles/
│   │   │   │   ├── page.tsx              # System toggles list
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx          # Toggle detail/history
│   │   │   │
│   │   │   ├── users/
│   │   │   │   ├── page.tsx              # User list with search/filter
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx          # User detail view
│   │   │   │       ├── usage/
│   │   │   │       │   └── page.tsx      # User usage metrics
│   │   │   │       └── subscription/
│   │   │   │           └── page.tsx      # User subscription details
│   │   │   │
│   │   │   ├── channels/
│   │   │   │   ├── page.tsx              # Channel list
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx          # Channel detail/moderation
│   │   │   │
│   │   │   ├── jobs/
│   │   │   │   ├── page.tsx              # Job queue monitor
│   │   │   │   ├── runpod/
│   │   │   │   │   └── page.tsx          # RunPod job management
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx          # Job detail view
│   │   │   │
│   │   │   ├── dlq/
│   │   │   │   ├── page.tsx              # Dead letter queue
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx          # DLQ message detail
│   │   │   │
│   │   │   ├── subscriptions/
│   │   │   │   ├── page.tsx              # Subscription analytics
│   │   │   │   ├── tiers/
│   │   │   │   │   └── page.tsx          # Tier management
│   │   │   │   └── revenue/
│   │   │   │       └── page.tsx          # Revenue dashboard
│   │   │   │
│   │   │   ├── infrastructure/
│   │   │   │   ├── page.tsx              # Infrastructure overview (all providers)
│   │   │   │   ├── hetzner/
│   │   │   │   │   ├── page.tsx          # Hetzner servers list
│   │   │   │   │   ├── provision/
│   │   │   │   │   │   └── page.tsx      # Provision new server
│   │   │   │   │   └── [id]/
│   │   │   │   │       └── page.tsx      # Server detail/metrics/actions
│   │   │   │   ├── runpod/
│   │   │   │   │   ├── page.tsx          # RunPod pods list + billing
│   │   │   │   │   ├── pods/
│   │   │   │   │   │   └── [id]/
│   │   │   │   │   │       └── page.tsx  # Pod detail/actions (stop/resume/terminate)
│   │   │   │   │   └── endpoints/
│   │   │   │   │       └── [id]/
│   │   │   │   │           └── page.tsx  # Endpoint scaling (workers min/max)
│   │   │   │   ├── workers/
│   │   │   │   │   └── page.tsx          # Cloudflare Workers status
│   │   │   │   ├── storage/
│   │   │   │   │   └── page.tsx          # R2/D1/KV storage
│   │   │   │   └── queues/
│   │   │   │       └── page.tsx          # Queue health
│   │   │   │
│   │   │   └── settings/
│   │   │       ├── page.tsx              # Admin settings
│   │   │       ├── admins/
│   │   │       │   └── page.tsx          # Manage admin users
│   │   │       └── audit/
│   │   │           └── page.tsx          # Audit log viewer
│   │   │
│   │   └── api/                          # API routes
│   │       ├── auth/
│   │       │   ├── login/
│   │       │   │   └── route.ts          # Admin login
│   │       │   ├── logout/
│   │       │   │   └── route.ts          # Admin logout
│   │       │   └── session/
│   │       │       └── route.ts          # Session check
│   │       │
│   │       ├── dashboard/
│   │       │   └── route.ts              # Dashboard metrics
│   │       │
│   │       ├── costs/
│   │       │   ├── route.ts              # Cost overview
│   │       │   ├── breakdown/
│   │       │   │   └── route.ts          # Detailed breakdown
│   │       │   └── forecast/
│   │       │       └── route.ts          # Projections
│   │       │
│   │       ├── toggles/
│   │       │   ├── route.ts              # List toggles
│   │       │   └── [id]/
│   │       │       └── route.ts          # Update toggle
│   │       │
│   │       ├── users/
│   │       │   ├── route.ts              # List users
│   │       │   └── [id]/
│   │       │       ├── route.ts          # User details
│   │       │       └── usage/
│   │       │           └── route.ts      # User usage
│   │       │
│   │       ├── jobs/
│   │       │   ├── route.ts              # List jobs
│   │       │   └── [id]/
│   │       │       ├── route.ts          # Job details
│   │       │       ├── retry/
│   │       │       │   └── route.ts      # Retry job
│   │       │       └── cancel/
│   │       │           └── route.ts      # Cancel job
│   │       │
│   │       ├── dlq/
│   │       │   ├── route.ts              # List DLQ messages
│   │       │   └── [id]/
│   │       │       ├── route.ts          # DLQ message detail
│   │       │       └── replay/
│   │       │           └── route.ts      # Replay message
│   │       │
│   │       └── subscriptions/
│   │           ├── route.ts              # Subscription stats
│   │           └── tiers/
│   │               └── route.ts          # Tier management
│   │
│   ├── components/
│   │   ├── ui/                           # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── skeleton.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/
│   │   │   ├── admin-nav.tsx             # Top navigation
│   │   │   ├── admin-sidebar.tsx         # Side navigation
│   │   │   ├── admin-header.tsx          # Page headers
│   │   │   └── admin-footer.tsx          # Footer
│   │   │
│   │   ├── dashboard/
│   │   │   ├── stats-card.tsx            # Metric display card
│   │   │   ├── cost-chart.tsx            # Cost visualization
│   │   │   ├── activity-feed.tsx         # Real-time activity
│   │   │   └── health-indicator.tsx      # Service health
│   │   │
│   │   ├── tables/
│   │   │   ├── users-table.tsx           # User data table
│   │   │   ├── jobs-table.tsx            # Job queue table
│   │   │   ├── dlq-table.tsx             # DLQ table
│   │   │   └── data-table.tsx            # Generic data table
│   │   │
│   │   ├── forms/
│   │   │   ├── toggle-form.tsx           # System toggle form
│   │   │   ├── tier-form.tsx             # Subscription tier form
│   │   │   └── admin-form.tsx            # Admin user form
│   │   │
│   │   └── charts/
│   │       ├── cost-breakdown-chart.tsx  # Cost pie/bar chart
│   │       ├── revenue-chart.tsx         # Revenue line chart
│   │       ├── usage-chart.tsx           # Usage trends
│   │       └── queue-depth-chart.tsx     # Queue metrics
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── admin-auth.ts             # Admin auth logic
│   │   │   ├── session.ts                # Session management
│   │   │   └── middleware.ts             # Auth middleware
│   │   │
│   │   ├── api/
│   │   │   ├── client.ts                 # API client for api-videos
│   │   │   ├── costs.ts                  # Cost calculation
│   │   │   ├── jobs.ts                   # Job management
│   │   │   └── users.ts                  # User management
│   │   │
│   │   ├── db/
│   │   │   ├── schema.ts                 # D1 schema types
│   │   │   ├── queries.ts                # Database queries
│   │   │   └── migrations/               # D1 migrations
│   │   │       ├── 0001_initial.sql
│   │   │       └── ...
│   │   │
│   │   ├── utils/
│   │   │   ├── format.ts                 # Number/date formatting
│   │   │   ├── currency.ts               # Currency helpers
│   │   │   └── time.ts                   # Time utilities
│   │   │
│   │   └── logger.ts                     # Admin logger
│   │
│   ├── hooks/
│   │   ├── use-dashboard-data.ts         # Dashboard data hook
│   │   ├── use-costs.ts                  # Cost data hook
│   │   ├── use-polling.ts                # Polling hook
│   │   └── use-admin-auth.ts             # Auth hook
│   │
│   ├── types/
│   │   ├── admin.ts                      # Admin-specific types
│   │   ├── costs.ts                      # Cost types
│   │   ├── jobs.ts                       # Job types
│   │   └── subscriptions.ts              # Subscription types
│   │
│   └── config/
│       ├── navigation.ts                 # Nav structure
│       ├── rate-tables.ts                # Cost rate tables
│       └── tiers.ts                      # Subscription tiers
│
├── public/
│   └── admin-logo.svg                    # Admin logo
│
├── wrangler.jsonc                        # Cloudflare Workers config
├── wrangler.staging.jsonc                # Staging config
├── wrangler.production.jsonc             # Production config
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.ts
├── components.json                       # shadcn/ui config
│
├── CLAUDE.md                             # AI assistant guide
└── README.md                             # App documentation
```

---

## 3. Package Configuration

### package.json

```json
{
  "name": "@al-ummah/admin",
  "version": "1.0.0",
  "private": true,
  "description": "Al Ummah Now - Admin Dashboard",
  "scripts": {
    "dev": "next dev -p 3090 --webpack",
    "build": "next build --webpack",
    "start": "next start -p 3090",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf .next .open-next node_modules",
    "check": "opennextjs-cloudflare build && tsc && wrangler deploy --dry-run",
    "deploy": "opennextjs-cloudflare build && wrangler deploy",
    "deploy:staging": "opennextjs-cloudflare build && wrangler deploy --config wrangler.staging.jsonc",
    "deploy:production": "opennextjs-cloudflare build && wrangler deploy --config wrangler.production.jsonc",
    "preview": "opennextjs-cloudflare build && wrangler dev",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts",
    "logs": "wrangler tail",
    "logs:staging": "wrangler tail --config wrangler.staging.jsonc",
    "logs:production": "wrangler tail --config wrangler.production.jsonc",
    "db:migrate": "wrangler d1 migrations apply admin-db",
    "db:migrate:staging": "wrangler d1 migrations apply admin-db --config wrangler.staging.jsonc",
    "db:migrate:production": "wrangler d1 migrations apply admin-db --config wrangler.production.jsonc"
  },
  "dependencies": {
    "@al-ummah/logger": "workspace:*",
    "@al-ummah/shared-types": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toast": "^1.2.6",
    "@tanstack/react-table": "^8.21.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^2.30.0",
    "lucide-react": "^0.487.0",
    "next": "^16.0.1",
    "next-themes": "^0.4.6",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "recharts": "^2.15.0",
    "tailwind-merge": "^3.2.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20251106.1",
    "@eslint/eslintrc": "^3.3.1",
    "@opennextjs/cloudflare": "^1.11.1",
    "@tailwindcss/postcss": "^4.1.17",
    "@types/node": "^24.10.0",
    "@types/react": "18.2.19",
    "@types/react-dom": "^18",
    "@typescript-eslint/eslint-plugin": "8.46.4",
    "@typescript-eslint/parser": "8.46.4",
    "eslint": "9.39.1",
    "eslint-config-next": "15.5.6",
    "postcss": "8.5.6",
    "tailwindcss": "^4.1.17",
    "typescript": "5.9.3",
    "wrangler": "^4.46.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"],
      "@al-ummah/shared-types": ["../../packages/shared-types/src"],
      "@al-ummah/logger": ["../../packages/logger/src"]
    },
    "types": ["@cloudflare/workers-types"]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    "cloudflare-env.d.ts"
  ],
  "exclude": ["node_modules"]
}
```

---

## 4. Wrangler Configuration

### wrangler.jsonc (Development)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "al-ummah-admin-preview",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },

  // D1 Database for admin data
  "d1_databases": [
    {
      "binding": "ADMIN_DB",
      "database_name": "admin-db-preview",
      "database_id": "PLACEHOLDER_PREVIEW_DB_ID"
    }
  ],

  // KV for session storage and caching
  "kv_namespaces": [
    {
      "binding": "ADMIN_SESSIONS",
      "id": "PLACEHOLDER_SESSIONS_KV_ID",
      "preview_id": "PLACEHOLDER_SESSIONS_KV_PREVIEW_ID"
    },
    {
      "binding": "ADMIN_CACHE",
      "id": "PLACEHOLDER_CACHE_KV_ID",
      "preview_id": "PLACEHOLDER_CACHE_KV_PREVIEW_ID"
    }
  ],

  // R2 buckets for accessing platform data (read-only)
  "r2_buckets": [
    {
      "binding": "PROFILES",
      "bucket_name": "profiles-preview"
    },
    {
      "binding": "CHANNELS",
      "bucket_name": "channels-preview"
    },
    {
      "binding": "VIDEOS",
      "bucket_name": "videos-preview"
    }
  ],

  // Service binding to api-videos
  "services": [
    {
      "binding": "API_VIDEOS",
      "service": "videos",
      "entrypoint": "default"
    }
  ],

  // Queue for admin actions audit log
  "queues": {
    "producers": [
      {
        "queue": "admin-audit-log",
        "binding": "AUDIT_QUEUE"
      }
    ]
  },

  // Environment variables
  "vars": {
    "ENVIRONMENT": "development",
    "API_URL": "http://127.0.0.1:3086",
    "ADMIN_EMAIL_DOMAIN": "alummahnow.net"
  },

  // Development server
  "dev": {
    "ip": "127.0.0.1",
    "port": 3090,
    "local_protocol": "http"
  }
}
```

### wrangler.production.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "al-ummah-admin",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],
  "logpush": true,
  "minify": true,
  "upload_source_maps": true,
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },

  // Production D1 Database
  "d1_databases": [
    {
      "binding": "ADMIN_DB",
      "database_name": "admin-db",
      "database_id": "PLACEHOLDER_PRODUCTION_DB_ID"
    }
  ],

  // Production KV namespaces
  "kv_namespaces": [
    {
      "binding": "ADMIN_SESSIONS",
      "id": "PLACEHOLDER_PROD_SESSIONS_KV_ID"
    },
    {
      "binding": "ADMIN_CACHE",
      "id": "PLACEHOLDER_PROD_CACHE_KV_ID"
    }
  ],

  // Production R2 buckets (read-only access)
  "r2_buckets": [
    {
      "binding": "PROFILES",
      "bucket_name": "profiles"
    },
    {
      "binding": "CHANNELS",
      "bucket_name": "channels"
    },
    {
      "binding": "VIDEOS",
      "bucket_name": "videos"
    }
  ],

  // Service binding to production api-videos
  "services": [
    {
      "binding": "API_VIDEOS",
      "service": "videos",
      "entrypoint": "default"
    }
  ],

  // Production queue
  "queues": {
    "producers": [
      {
        "queue": "admin-audit-log",
        "binding": "AUDIT_QUEUE"
      }
    ]
  },

  // Production environment variables
  "vars": {
    "ENVIRONMENT": "production",
    "API_URL": "https://videos.api.alummahnow.net",
    "ADMIN_EMAIL_DOMAIN": "alummahnow.net"
  },

  // Custom domain (to be configured)
  "routes": [
    {
      "pattern": "admin.alummahnow.net/*",
      "zone_name": "alummahnow.net"
    }
  ]
}
```

---

## 5. Tech Stack Decisions

### ADR-001: Frontend Framework

**Decision**: Use Next.js 15 with React 19

**Context**:
- Options considered: Next.js, Hono + htmx, React SPA, Svelte
- Admin dashboard needs: SSR for initial load, dynamic updates, complex forms

**Rationale**:
1. **Consistency**: Same framework as web app, shared knowledge
2. **SSR**: Dashboard loads fast with server-rendered initial state
3. **API Routes**: Built-in API routes for admin endpoints
4. **Tooling**: Excellent TypeScript support, hot reload
5. **Deployment**: OpenNext for Cloudflare Workers already proven

**Consequences**:
- Build times may be long (mitigated by caching)
- Need to handle edge runtime limitations

### ADR-002: UI Component Library

**Decision**: Use Tailwind CSS + shadcn/ui

**Rationale**:
1. **Consistency**: Same as web app
2. **Customization**: Full control over components
3. **Accessibility**: Built-in a11y
4. **No Bundle Size**: Copy-paste, not npm dependency

### ADR-003: Data Visualization

**Decision**: Use Recharts

**Rationale**:
1. **React Native**: Built for React, works with SSR
2. **Responsive**: Charts adapt to container size
3. **Composable**: Build custom chart combinations
4. **Lightweight**: Tree-shakeable, ~200KB

### ADR-004: Table Component

**Decision**: Use TanStack Table (React Table v8)

**Rationale**:
1. **Headless**: Full control over UI
2. **Features**: Sorting, filtering, pagination built-in
3. **TypeScript**: Excellent type inference
4. **Server-side**: Works with server-side data fetching

---

## 6. Authentication Architecture

### Overview

Admin authentication is **completely separate** from user authentication (OpenAuth).

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                               │
│  │  Admin User  │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────┐                                       │
│  │  /login              │                                       │
│  │  - Email input       │                                       │
│  │  - Must be @domain   │                                       │
│  └──────┬───────────────┘                                       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────┐                                       │
│  │  Magic Link Email    │  (No password, more secure)           │
│  │  - 15 min expiry     │                                       │
│  │  - Single use        │                                       │
│  └──────┬───────────────┘                                       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────┐                                       │
│  │  /api/auth/verify    │                                       │
│  │  - Validate token    │                                       │
│  │  - Check admin list  │                                       │
│  │  - Create session    │                                       │
│  └──────┬───────────────┘                                       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────┐                                       │
│  │  Session Cookie      │                                       │
│  │  - HttpOnly          │                                       │
│  │  - Secure            │                                       │
│  │  - SameSite=Strict   │                                       │
│  │  - 8 hour expiry     │                                       │
│  └──────────────────────┘                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### D1 Schema: Admin Users

```sql
-- Admin users (very small table)
CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',      -- 'admin', 'super_admin'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    last_login_at TEXT
);

-- Magic link tokens
CREATE TABLE admin_magic_links (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Active sessions
CREATE TABLE admin_sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Audit log
CREATE TABLE admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT,                            -- JSON
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log(admin_id, created_at);
CREATE INDEX idx_admin_audit_log_resource ON admin_audit_log(resource_type, resource_id);
```

### Session Management

```typescript
// src/lib/auth/session.ts

import { D1Database, KVNamespace } from '@cloudflare/workers-types';

interface AdminSession {
  adminId: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
  expiresAt: number;
}

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export async function createSession(
  db: D1Database,
  kv: KVNamespace,
  adminId: string,
  ipAddress: string,
  userAgent: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = await hashToken(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  // Store in D1 for persistence
  await db.prepare(`
    INSERT INTO admin_sessions (id, admin_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(sessionId, adminId, tokenHash, ipAddress, userAgent, expiresAt.toISOString()).run();

  // Cache in KV for fast lookups
  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(adminId).first();
  await kv.put(`session:${tokenHash}`, JSON.stringify({
    adminId,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    expiresAt: expiresAt.getTime(),
  }), { expirationTtl: SESSION_DURATION_MS / 1000 });

  return sessionId;
}

export async function validateSession(
  kv: KVNamespace,
  sessionToken: string
): Promise<AdminSession | null> {
  const tokenHash = await hashToken(sessionToken);
  const cached = await kv.get(`session:${tokenHash}`, 'json') as AdminSession | null;

  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    await kv.delete(`session:${tokenHash}`);
    return null;
  }

  return cached;
}

export async function destroySession(
  db: D1Database,
  kv: KVNamespace,
  sessionToken: string
): Promise<void> {
  const tokenHash = await hashToken(sessionToken);
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
  await kv.delete(`session:${tokenHash}`);
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### Middleware

```typescript
// src/middleware.ts (Next.js middleware)

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/verify'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('admin_session')?.value;

  if (!sessionToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Session validation happens in API routes/server components
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|admin-logo.svg).*)',
  ],
};
```

---

## 7. Routes and Pages

### Route Structure

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard Overview | Key metrics, health, alerts |
| `/costs` | Cost Dashboard | Real-time cost tracking |
| `/costs/breakdown` | Cost Breakdown | Detailed by category |
| `/costs/forecast` | Cost Forecast | Projections |
| `/toggles` | System Toggles | Feature on/off switches |
| `/toggles/[id]` | Toggle Detail | Toggle history, impact |
| `/users` | User Management | User list, search, filter |
| `/users/[id]` | User Detail | User info, actions |
| `/users/[id]/usage` | User Usage | User metrics |
| `/users/[id]/subscription` | User Subscription | Subscription details |
| `/channels` | Channel List | All channels |
| `/channels/[id]` | Channel Detail | Channel moderation |
| `/jobs` | Job Monitor | Queue overview |
| `/jobs/runpod` | RunPod Jobs | GPU job management |
| `/jobs/[id]` | Job Detail | Job logs, retry |
| `/dlq` | Dead Letter Queue | Failed messages |
| `/dlq/[id]` | DLQ Detail | Message replay |
| `/subscriptions` | Subscription Analytics | Overview |
| `/subscriptions/tiers` | Tier Management | Edit tiers |
| `/subscriptions/revenue` | Revenue Dashboard | MRR, growth |
| `/infrastructure` | Infrastructure | All providers overview, monthly costs |
| `/infrastructure/hetzner` | Hetzner Servers | StreamPot servers list |
| `/infrastructure/hetzner/provision` | Provision Server | Create new Hetzner server |
| `/infrastructure/hetzner/[id]` | Server Detail | Metrics, actions (poweron/off/reboot) |
| `/infrastructure/runpod` | RunPod Dashboard | Pods, endpoints, billing |
| `/infrastructure/runpod/pods/[id]` | Pod Detail | Pod actions (stop/resume/terminate) |
| `/infrastructure/runpod/endpoints/[id]` | Endpoint Scaling | Adjust workers min/max |
| `/infrastructure/workers` | Workers Status | CF Workers health |
| `/infrastructure/storage` | Storage Status | R2/D1/KV usage |
| `/infrastructure/queues` | Queue Status | Queue health, DLQ count |
| `/settings` | Admin Settings | App settings |
| `/settings/admins` | Admin Users | Manage admins |
| `/settings/audit` | Audit Log | Action history |

### Dashboard Overview Page

```tsx
// src/app/(dashboard)/page.tsx

import { Suspense } from 'react';
import { StatsCard } from '@/components/dashboard/stats-card';
import { CostChart } from '@/components/dashboard/cost-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { HealthIndicator } from '@/components/dashboard/health-indicator';
import { getDashboardData } from '@/lib/api/dashboard';

export const runtime = 'edge';

export default async function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Suspense fallback={<StatsCard.Skeleton />}>
          <RevenueCard />
        </Suspense>
        <Suspense fallback={<StatsCard.Skeleton />}>
          <CostsCard />
        </Suspense>
        <Suspense fallback={<StatsCard.Skeleton />}>
          <MarginCard />
        </Suspense>
        <Suspense fallback={<StatsCard.Skeleton />}>
          <UsersCard />
        </Suspense>
      </div>

      {/* Cost Chart & Infrastructure Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Suspense fallback={<CostChart.Skeleton />}>
          <CostChartSection />
        </Suspense>
        <Suspense fallback={<HealthIndicator.Skeleton />}>
          <InfrastructureHealth />
        </Suspense>
      </div>

      {/* Activity Feed */}
      <Suspense fallback={<ActivityFeed.Skeleton />}>
        <RecentActivity />
      </Suspense>
    </div>
  );
}

async function RevenueCard() {
  const data = await getDashboardData();
  return (
    <StatsCard
      title="Revenue"
      value={`$${(data.revenue.mrrCents / 100).toFixed(2)}`}
      subtitle="MRR"
      trend={data.revenue.growthPercent}
    />
  );
}

// ... more components
```

### System Toggles Page

```tsx
// src/app/(dashboard)/toggles/page.tsx

import { getSystemToggles } from '@/lib/api/toggles';
import { ToggleCard } from '@/components/toggles/toggle-card';

export const runtime = 'edge';

export default async function TogglesPage() {
  const toggles = await getSystemToggles();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">System Toggles</h1>
        <p className="text-muted-foreground">
          Control platform-wide features
        </p>
      </div>

      <div className="grid gap-4">
        {toggles.map((toggle) => (
          <ToggleCard
            key={toggle.name}
            toggle={toggle}
          />
        ))}
      </div>

      <div className="rounded-lg border p-4 bg-muted/50">
        <h3 className="font-semibold mb-2">Important Notes</h3>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          <li>Toggling affects all users platform-wide</li>
          <li>Changes take effect within 1 minute</li>
          <li>Monthly cost estimates are based on current usage patterns</li>
          <li>All toggle changes are logged in the audit trail</li>
        </ul>
      </div>
    </div>
  );
}
```

---

## 8. API Routes

### API Structure

```
/api/
├── auth/
│   ├── login             POST    Send magic link
│   ├── verify            GET     Verify magic link token
│   ├── logout            POST    Destroy session
│   └── session           GET     Check session status
│
├── dashboard             GET     Dashboard metrics
│
├── costs/
│   ├── /                 GET     Cost overview
│   ├── /breakdown        GET     Detailed breakdown
│   └── /forecast         GET     Projections
│
├── toggles/
│   ├── /                 GET     List all toggles
│   └── /[id]             GET     Toggle details
│                         PUT     Update toggle
│
├── users/
│   ├── /                 GET     List users (paginated)
│   ├── /[id]             GET     User details
│   ├── /[id]/usage       GET     User usage metrics
│   └── /[id]/subscription GET    User subscription
│                         PUT     Update subscription
│
├── channels/
│   ├── /                 GET     List channels
│   └── /[id]             GET     Channel details
│                         PUT     Update channel (moderation)
│
├── jobs/
│   ├── /                 GET     List jobs
│   ├── /metrics          GET     Job metrics
│   ├── /[id]             GET     Job details
│   ├── /[id]/retry       POST    Retry job
│   └── /[id]/cancel      POST    Cancel job
│
├── dlq/
│   ├── /                 GET     List DLQ messages
│   ├── /[id]             GET     Message details
│   ├── /[id]/replay      POST    Replay message
│   └── /[id]/resolve     POST    Mark resolved
│
├── subscriptions/
│   ├── /                 GET     Subscription analytics
│   ├── /tiers            GET     List tiers
│   │                     PUT     Update tier
│   └── /revenue          GET     Revenue metrics
│
├── infrastructure/
│   ├── /                 GET     All providers overview + total costs
│   │
│   ├── /hetzner/
│   │   ├── /             GET     List Hetzner servers
│   │   ├── /pricing      GET     Get Hetzner pricing
│   │   ├── /provision    POST    Provision new server (cloud-init)
│   │   └── /[id]/
│   │       ├── /         GET     Server details + metrics
│   │       ├── /action   POST    Server action (poweron/poweroff/shutdown/reboot/reset)
│   │       ├── /metrics  GET     Server CPU/disk/network metrics
│   │       └── /delete   DELETE  Delete server
│   │
│   └── /runpod/
│       ├── /             GET     List pods + billing summary
│       ├── /billing      GET     Detailed billing (balance, spend breakdown)
│       ├── /gpu-pricing  GET     Available GPU types with pricing
│       ├── /pods/
│       │   ├── /         GET     List all pods
│       │   ├── /create   POST    Create new pod
│       │   └── /[id]/
│       │       ├── /     GET     Pod details
│       │       └── /action POST  Pod action (stop/resume/terminate)
│       └── /endpoints/
│           ├── /         GET     List serverless endpoints
│           └── /[id]/
│               ├── /     GET     Endpoint details
│               └── /scale POST   Update scaling (workersMin/workersMax)
│
└── settings/
    ├── /admins           GET     List admins
    │                     POST    Create admin
    ├── /admins/[id]      PUT     Update admin
    │                     DELETE  Deactivate admin
    └── /audit            GET     Audit log
```

### Example API Route: Toggle Update

```typescript
// src/app/api/toggles/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { z } from 'zod';

const UpdateToggleSchema = z.object({
  enabled: z.boolean(),
});

export const runtime = 'edge';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = getRequestContext();
  const env = ctx.env as Env;

  // Validate session
  const sessionToken = request.cookies.get('admin_session')?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await validateSession(env.ADMIN_SESSIONS, sessionToken);
  if (!session) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  // Parse and validate body
  const body = await request.json();
  const parsed = UpdateToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { id } = params;
  const { enabled } = parsed.data;

  // Get current toggle state
  const toggle = await env.ADMIN_DB.prepare(
    'SELECT * FROM system_toggles WHERE name = ?'
  ).bind(id).first();

  if (!toggle) {
    return NextResponse.json({ error: 'Toggle not found' }, { status: 404 });
  }

  // Update toggle
  await env.ADMIN_DB.prepare(`
    UPDATE system_toggles
    SET enabled = ?, updated_by = ?, updated_at = ?
    WHERE name = ?
  `).bind(
    enabled ? 1 : 0,
    session.adminId,
    new Date().toISOString(),
    id
  ).run();

  // Clear cache
  await env.ADMIN_CACHE.delete(`toggle:${id}`);

  // Audit log
  await env.AUDIT_QUEUE.send({
    adminId: session.adminId,
    action: 'toggle_updated',
    resourceType: 'system_toggle',
    resourceId: id,
    details: JSON.stringify({ previousValue: toggle.enabled === 1, newValue: enabled }),
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    toggle: { ...toggle, enabled },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = getRequestContext();
  const env = ctx.env as Env;

  // Validate session
  const sessionToken = request.cookies.get('admin_session')?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  // Check cache
  const cached = await env.ADMIN_CACHE.get(`toggle:${id}`, 'json');
  if (cached) {
    return NextResponse.json(cached);
  }

  // Fetch from DB
  const toggle = await env.ADMIN_DB.prepare(`
    SELECT t.*, a.email as updated_by_email
    FROM system_toggles t
    LEFT JOIN admin_users a ON t.updated_by = a.id
    WHERE t.name = ?
  `).bind(id).first();

  if (!toggle) {
    return NextResponse.json({ error: 'Toggle not found' }, { status: 404 });
  }

  // Get toggle history
  const history = await env.ADMIN_DB.prepare(`
    SELECT * FROM admin_audit_log
    WHERE resource_type = 'system_toggle' AND resource_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(id).all();

  const result = { toggle, history: history.results };

  // Cache for 1 minute
  await env.ADMIN_CACHE.put(`toggle:${id}`, JSON.stringify(result), { expirationTtl: 60 });

  return NextResponse.json(result);
}
```

### Example API Route: Cost Dashboard

```typescript
// src/app/api/costs/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { calculateRealTimeCosts } from '@/lib/api/costs';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const ctx = getRequestContext();
  const env = ctx.env as Env;

  // Validate session
  const sessionToken = request.cookies.get('admin_session')?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await validateSession(env.ADMIN_SESSIONS, sessionToken);
  if (!session) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  // Check cache (30 second TTL for real-time feel)
  const cacheKey = 'costs:current';
  const cached = await env.ADMIN_CACHE.get(cacheKey, 'json');
  if (cached) {
    return NextResponse.json(cached);
  }

  // Calculate costs from metrics
  const costs = await calculateRealTimeCosts(env.ADMIN_DB);

  // Cache for 30 seconds
  await env.ADMIN_CACHE.put(cacheKey, JSON.stringify(costs), { expirationTtl: 30 });

  return NextResponse.json(costs);
}
```

---

## 9. D1 Database Bindings

### Database Schema

```sql
-- D1 Migration: 0001_initial.sql

-- =====================================================
-- ADMIN AUTHENTICATION
-- =====================================================

CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',  -- 'admin', 'super_admin'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    last_login_at TEXT
);

CREATE TABLE admin_magic_links (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SYSTEM CONFIGURATION
-- =====================================================

CREATE TABLE system_toggles (
    name TEXT PRIMARY KEY,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT REFERENCES admin_users(id),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE system_budgets (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL UNIQUE,  -- '2025-01'
    budget_cents INTEGER NOT NULL,
    alert_threshold_percent INTEGER DEFAULT 80,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- METRICS COLLECTION (for cost calculation)
-- =====================================================

CREATE TABLE usage_metrics (
    id TEXT PRIMARY KEY,
    metric_type TEXT NOT NULL,        -- 'storage', 'bandwidth', 'transcription', etc.
    scope TEXT NOT NULL,              -- 'system', 'user', 'channel', 'video'
    scope_id TEXT,                    -- user_id, channel_id, or video_id

    -- Raw values
    value_bytes INTEGER,
    value_minutes REAL,
    value_seconds REAL,
    value_tokens INTEGER,
    value_requests INTEGER,

    period TEXT NOT NULL,             -- '2025-01'
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL              -- 'upload', 'processor', 'api', 'cron'
);

-- =====================================================
-- JOB TRACKING
-- =====================================================

CREATE TABLE runpod_jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    job_type TEXT NOT NULL,           -- 'transcription', 'embedding'
    status TEXT NOT NULL,             -- 'pending', 'queued', 'running', 'completed', 'failed'

    runpod_job_id TEXT,
    gpu_type TEXT,

    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,

    gpu_seconds_used INTEGER,
    estimated_cost_cents INTEGER,

    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    next_retry_at TEXT,

    priority INTEGER DEFAULT 0
);

CREATE TABLE dead_letter_queue (
    id TEXT PRIMARY KEY,
    original_queue TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload TEXT NOT NULL,            -- JSON
    error TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    first_failed_at TEXT NOT NULL,
    last_failed_at TEXT NOT NULL,
    replayed_at TEXT,
    resolved_at TEXT,
    resolved_by TEXT REFERENCES admin_users(id),
    resolution_notes TEXT
);

-- =====================================================
-- SUBSCRIPTIONS & BILLING
-- =====================================================

CREATE TABLE subscription_tiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    monthly_price_cents INTEGER NOT NULL,
    yearly_price_cents INTEGER NOT NULL,
    quotas TEXT NOT NULL,             -- JSON
    features TEXT NOT NULL,           -- JSON
    overage_rates TEXT NOT NULL,      -- JSON
    is_active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    tier_id TEXT NOT NULL REFERENCES subscription_tiers(id),
    status TEXT NOT NULL,             -- 'active', 'cancelled', 'past_due'
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    cancel_at_period_end INTEGER DEFAULT 0,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,             -- '2025-01'

    storage_used_bytes INTEGER DEFAULT 0,
    upload_minutes_used INTEGER DEFAULT 0,
    bandwidth_bytes_used INTEGER DEFAULT 0,
    transcription_minutes_used INTEGER DEFAULT 0,

    videos_uploaded INTEGER DEFAULT 0,
    channels_created INTEGER DEFAULT 0,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, period)
);

-- =====================================================
-- AUDIT LOG
-- =====================================================

CREATE TABLE admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT,                     -- JSON
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_magic_links_token ON admin_magic_links(token);
CREATE INDEX idx_admin_magic_links_email ON admin_magic_links(email);

CREATE INDEX idx_usage_metrics_scope ON usage_metrics(scope, scope_id, period);
CREATE INDEX idx_usage_metrics_type ON usage_metrics(metric_type, period);

CREATE INDEX idx_runpod_jobs_status ON runpod_jobs(status);
CREATE INDEX idx_runpod_jobs_video ON runpod_jobs(video_id);
CREATE INDEX idx_runpod_jobs_retry ON runpod_jobs(next_retry_at) WHERE status = 'pending';

CREATE INDEX idx_dlq_replayed ON dead_letter_queue(replayed_at) WHERE replayed_at IS NULL;
CREATE INDEX idx_dlq_type ON dead_letter_queue(message_type);

CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_usage_user_period ON user_usage(user_id, period);

CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log(admin_id, created_at);
CREATE INDEX idx_admin_audit_log_resource ON admin_audit_log(resource_type, resource_id);

-- =====================================================
-- SEED DATA
-- =====================================================

-- Initial system toggles
INSERT INTO system_toggles (name, description, enabled) VALUES
    ('transcription', 'AI-powered video transcription for all new uploads', 1),
    ('ai_search', 'Semantic search across all video transcripts', 1),
    ('auto_embedding', 'Generate embeddings for new transcripts automatically', 1),
    ('live_streaming', 'Allow users to create live streams', 1),
    ('scheduled_publishing', 'Allow scheduling videos for future release', 1);

-- Initial subscription tiers
INSERT INTO subscription_tiers (id, name, name_ar, monthly_price_cents, yearly_price_cents, quotas, features, overage_rates, display_order) VALUES
    ('free', 'Free', 'مجاني', 0, 0,
     '{"storageGB":5,"uploadMinutesPerMonth":60,"channelsAllowed":1,"videosPerChannel":50,"maxVideoLengthMinutes":15,"maxFileSizeGB":1}',
     '{"transcription":false,"aiSearch":false,"analytics":"basic","customBranding":false,"priorityProcessing":false,"apiAccess":false,"liveStreaming":false}',
     '{"storagePerGB":0,"bandwidthPerGB":0,"transcriptionPerMinute":0}',
     1),
    ('creator', 'Creator', 'منشئ', 999, 9990,
     '{"storageGB":100,"uploadMinutesPerMonth":600,"channelsAllowed":3,"videosPerChannel":500,"maxVideoLengthMinutes":120,"maxFileSizeGB":10}',
     '{"transcription":true,"aiSearch":true,"analytics":"advanced","customBranding":false,"priorityProcessing":false,"apiAccess":false,"liveStreaming":false}',
     '{"storagePerGB":2,"bandwidthPerGB":2,"transcriptionPerMinute":3}',
     2),
    ('professional', 'Professional', 'محترف', 2999, 29990,
     '{"storageGB":1000,"uploadMinutesPerMonth":6000,"channelsAllowed":10,"videosPerChannel":2000,"maxVideoLengthMinutes":480,"maxFileSizeGB":50}',
     '{"transcription":true,"aiSearch":true,"analytics":"full","customBranding":true,"priorityProcessing":true,"apiAccess":true,"liveStreaming":true}',
     '{"storagePerGB":1,"bandwidthPerGB":1,"transcriptionPerMinute":2}',
     3),
    ('organization', 'Organization', 'مؤسسة', 9999, 99990,
     '{"storageGB":10000,"uploadMinutesPerMonth":60000,"channelsAllowed":100,"videosPerChannel":10000,"maxVideoLengthMinutes":720,"maxFileSizeGB":100}',
     '{"transcription":true,"aiSearch":true,"analytics":"full","customBranding":true,"priorityProcessing":true,"apiAccess":true,"liveStreaming":true}',
     '{"storagePerGB":1,"bandwidthPerGB":1,"transcriptionPerMinute":2}',
     4);
```

---

## 10. KV Bindings

### KV Namespaces

| Binding | Purpose | TTL Strategy |
|---------|---------|--------------|
| `ADMIN_SESSIONS` | Session data cache | 8 hours |
| `ADMIN_CACHE` | Dashboard data cache | 30s - 5min |

### Key Patterns

```typescript
// Session keys
`session:${tokenHash}` -> AdminSession (TTL: 8 hours)

// Cache keys
`costs:current` -> RealTimeCosts (TTL: 30s)
`toggle:${name}` -> ToggleWithHistory (TTL: 1 min)
`dashboard:metrics` -> DashboardMetrics (TTL: 30s)
`users:list:${page}:${filter}` -> UserList (TTL: 1 min)
`user:${id}` -> UserDetails (TTL: 2 min)
`jobs:active` -> ActiveJobs (TTL: 30s)
`dlq:count` -> number (TTL: 1 min)
`subscriptions:stats` -> SubscriptionStats (TTL: 5 min)
```

---

## 11. Integration with api-videos

### Service Binding

The admin app uses a **Cloudflare Service Binding** to call api-videos directly without network latency:

```typescript
// src/lib/api/client.ts

import { getRequestContext } from '@cloudflare/next-on-pages';

export async function callApiVideos<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const ctx = getRequestContext();
  const env = ctx.env as Env;

  // Service binding - internal call, no network hop
  const response = await env.API_VIDEOS.fetch(
    new Request(`https://internal${path}`, {
      ...options,
      headers: {
        ...options.headers,
        'X-Admin-Request': 'true',
        'X-Admin-Service': 'admin-dashboard',
      },
    })
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
```

### API Videos Changes Required

Add admin-specific endpoints to api-videos:

```typescript
// apps/api-videos/src/endpoints/admin/index.ts

// Internal endpoints only accessible via service binding
app.get('/internal/admin/users', adminAuthMiddleware, listUsersEndpoint);
app.get('/internal/admin/users/:id', adminAuthMiddleware, getUserEndpoint);
app.get('/internal/admin/channels', adminAuthMiddleware, listChannelsEndpoint);
app.get('/internal/admin/videos/stats', adminAuthMiddleware, videoStatsEndpoint);
app.get('/internal/admin/metrics', adminAuthMiddleware, metricsEndpoint);
```

### Fallback: HTTP API

For development or when service binding is unavailable:

```typescript
// src/lib/api/client.ts

export async function callApiVideos<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const ctx = getRequestContext();
  const env = ctx.env as Env;

  // Try service binding first
  if (env.API_VIDEOS) {
    try {
      const response = await env.API_VIDEOS.fetch(
        new Request(`https://internal${path}`, options)
      );
      return response.json();
    } catch (error) {
      console.warn('Service binding failed, falling back to HTTP');
    }
  }

  // Fallback to HTTP
  const response = await fetch(`${env.API_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${await getInternalToken(env)}`,
    },
  });

  return response.json();
}
```

---

## 12. Real-Time Updates Strategy

### Decision: Polling with Manual Refresh

**Why not WebSocket?**

1. Admin users are few (< 10 concurrent)
2. Real-time to-the-second updates not critical
3. Simpler implementation and maintenance
4. No need for separate WebSocket infrastructure

### Polling Strategy

| Data Type | Interval | Rationale |
|-----------|----------|-----------|
| Dashboard metrics | 30s | Near real-time cost tracking |
| Job queue | 30s | Monitor processing |
| Health status | 60s | Slower changing |
| User lists | Manual | Changes infrequently |
| DLQ | 60s | Alert on new items |

### Implementation

```typescript
// src/hooks/use-polling.ts

import { useState, useEffect, useCallback } from 'react';

interface UsePollingOptions<T> {
  fetcher: () => Promise<T>;
  interval: number;
  enabled?: boolean;
}

export function usePolling<T>({
  fetcher,
  interval,
  enabled = true,
}: UsePollingOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await fetcher();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    refresh();

    // Set up polling
    const intervalId = setInterval(refresh, interval);

    return () => clearInterval(intervalId);
  }, [enabled, interval, refresh]);

  return { data, error, isLoading, lastUpdated, refresh };
}
```

### Usage in Components

```tsx
// src/components/dashboard/cost-card.tsx

'use client';

import { usePolling } from '@/hooks/use-polling';
import { fetchCosts } from '@/lib/api/costs';

export function CostCard() {
  const { data, isLoading, lastUpdated, refresh } = usePolling({
    fetcher: fetchCosts,
    interval: 30000, // 30 seconds
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Costs (MTD)</CardTitle>
        <Button variant="ghost" size="icon" onClick={refresh}>
          <RefreshIcon className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <Skeleton className="h-12" />
        ) : (
          <>
            <div className="text-3xl font-bold">
              ${((data?.actualCosts.total || 0) / 100).toFixed(2)}
            </div>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(lastUpdated)} ago
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

---

## 13. UI/UX Requirements

### Design Principles

1. **Information Density**: Show more data, fewer clicks
2. **Scannable**: Key metrics visible at a glance
3. **Actionable**: Clear CTAs, easy to take action
4. **Responsive**: Works on tablet (minimum), desktop primary
5. **Accessible**: WCAG 2.1 AA compliance

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Logo] Al Ummah Admin     [Search]        [Theme] [Notifications] [User]│
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  Dashboard │  ┌─────────────────────────────────────────────────┐   │
│  Costs     │  │                 PAGE CONTENT                     │   │
│  Toggles   │  │                                                  │   │
│  Users     │  │  - Stats cards                                   │   │
│  Channels  │  │  - Charts                                        │   │
│  Jobs      │  │  - Tables                                        │   │
│  DLQ       │  │  - Forms                                         │   │
│  Subs      │  │                                                  │   │
│  Infra     │  │                                                  │   │
│  ──────    │  │                                                  │   │
│  Settings  │  └─────────────────────────────────────────────────┘   │
│            │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

### Color Scheme

- **Primary**: Blue (#0066FF) - Actions, links
- **Success**: Green (#22C55E) - Positive metrics, health
- **Warning**: Yellow (#EAB308) - Alerts, caution
- **Error**: Red (#EF4444) - Errors, critical
- **Neutral**: Gray scale - Backgrounds, borders

### Dark Mode

Required. Default to system preference, with toggle.

### Mobile Support

- Minimum viewport: 768px (tablet)
- Sidebar collapses to hamburger menu
- Tables become card lists on narrow screens
- Charts resize responsively

---

## 14. Security Considerations

### Access Control

1. **Email Domain Restriction**: Only `@alummahnow.net` emails
2. **Explicit Allowlist**: Admin users must be in `admin_users` table
3. **Role-Based**: `admin` vs `super_admin` for sensitive actions
4. **Session Limits**: 8-hour sessions, single use magic links

### Infrastructure Credentials Protection

All infrastructure API credentials stored as Cloudflare secrets (never in code):
- `HETZNER_API_TOKEN` - Hetzner Cloud API token (Read & Write)
- `RUNPOD_API_KEY` - RunPod API key
- `STREAMPOT_API_KEY` - StreamPot service API key
- `R2_ACCESS_KEY` - R2 access key for infrastructure
- `R2_SECRET_KEY` - R2 secret key for infrastructure

### Audit Trail

All admin actions logged:

```typescript
interface AuditLogEntry {
  adminId: string;
  action: string;           // 'toggle_updated', 'user_suspended', etc.
  resourceType: string;     // 'system_toggle', 'user', 'channel'
  resourceId: string;
  details: object;          // Before/after values
  ipAddress: string;
  timestamp: string;
}
```

### Rate Limiting

- Login attempts: 5 per email per 15 minutes
- API requests: 100 per minute per session
- Bulk operations: 10 per minute

### Data Protection

1. **No User Passwords**: Magic link authentication
2. **Session Tokens**: Hashed in database
3. **Sensitive Data**: Cost data not cached long-term
4. **Service Binding**: Internal API calls, no exposed endpoints

---

## 15. Deployment Strategy

### Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Development | localhost:3090 | Local development |
| Preview | al-ummah-admin-preview.workers.dev | PR previews |
| Staging | admin-staging.alummahnow.net | Pre-production |
| Production | admin.alummahnow.net | Live |

### CI/CD Pipeline

Add to `.github/workflows/deploy.yml`:

```yaml
# Admin app jobs
validate-admin:
  runs-on: ubuntu-latest
  needs: [test, build-shared-types]
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v2
      with:
        version: 9.15.4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'pnpm'
    - run: pnpm install
    - run: pnpm --filter @al-ummah/admin type-check
    - run: pnpm --filter @al-ummah/admin lint

build-admin:
  runs-on: ubuntu-latest
  needs: validate-admin
  if: github.ref == 'refs/heads/main'
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v2
    - uses: actions/setup-node@v4
    - run: pnpm install
    - run: pnpm --filter @al-ummah/admin build
    - uses: cloudflare/wrangler-action@v3
      with:
        apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        workingDirectory: apps/admin
        command: deploy --config wrangler.production.jsonc
```

### Database Migrations

```bash
# Apply migrations to staging
pnpm --filter @al-ummah/admin db:migrate:staging

# Apply migrations to production
pnpm --filter @al-ummah/admin db:migrate:production
```

---

## 16. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic app structure with authentication

- [ ] Create `apps/admin` directory structure
- [ ] Set up Next.js 15 with Cloudflare Workers
- [ ] Implement admin authentication (magic link)
- [ ] Create D1 database and run migrations
- [ ] Set up KV namespaces
- [ ] Deploy to preview environment
- [ ] Basic dashboard layout with sidebar

**Deliverables**:
- Working authentication flow
- Empty dashboard with navigation
- D1 database created with schema

### Phase 2: Dashboard Core (Week 3-4)

**Goal**: Real-time cost tracking and system toggles

- [ ] Implement cost calculation from metrics
- [ ] Dashboard overview page with key metrics
- [ ] Cost breakdown page
- [ ] System toggles page with on/off switches
- [ ] Polling hooks for real-time updates
- [ ] Basic charts (Recharts)

**Deliverables**:
- Real-time cost dashboard
- Working system toggles
- Cost breakdown visualization

### Phase 3: User & Content Management (Week 5-6)

**Goal**: User and channel management

- [ ] User list with search/filter
- [ ] User detail page with usage
- [ ] Channel list and detail pages
- [ ] Service binding to api-videos
- [ ] User subscription management

**Deliverables**:
- User management interface
- Channel moderation interface
- Subscription editing

### Phase 4: Job & Queue Management (Week 7-8)

**Goal**: Infrastructure monitoring

- [ ] Job queue monitor
- [ ] RunPod job management
- [ ] Dead letter queue viewer
- [ ] Job retry/cancel actions
- [ ] DLQ replay functionality
- [ ] Infrastructure health page

**Deliverables**:
- Job monitoring dashboard
- DLQ management interface
- Infrastructure status page

### Phase 5: Analytics & Polish (Week 9-10)

**Goal**: Subscription analytics and refinement

- [ ] Subscription analytics dashboard
- [ ] Revenue metrics
- [ ] Cost forecasting
- [ ] Audit log viewer
- [ ] Admin user management
- [ ] Dark mode polish
- [ ] Performance optimization

**Deliverables**:
- Complete subscription analytics
- Audit trail interface
- Production-ready UI

### Phase 6: Documentation & Launch (Week 11-12)

**Goal**: Production deployment

- [ ] Write CLAUDE.md for admin app
- [ ] Write README.md
- [ ] Update main CLAUDE.md with admin app info
- [ ] Production deployment
- [ ] Initial admin user setup
- [ ] Monitoring and alerting setup

**Deliverables**:
- Complete documentation
- Production deployment
- Runbook for operations

---

## Appendix A: Type Definitions

```typescript
// src/types/admin.ts

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminSession {
  adminId: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
  expiresAt: number;
}

export interface SystemToggle {
  name: string;
  description: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
  estimatedMonthlyCostCents?: number;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail?: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
```

```typescript
// src/types/costs.ts

export interface RealTimeCosts {
  currentPeriod: {
    month: string;
    daysElapsed: number;
    daysRemaining: number;
  };
  actualCosts: {
    storage: { bytes: number; costCents: number };
    bandwidth: { bytes: number; costCents: number };
    transcription: { minutes: number; costCents: number };
    embedding: { tokens: number; costCents: number };
    gpu: { seconds: number; costCents: number };
    total: number;
  };
  projectedCosts: {
    storage: number;
    bandwidth: number;
    transcription: number;
    total: number;
  };
  budget: {
    monthlyBudgetCents: number;
    currentSpendCents: number;
    projectedSpendCents: number;
    variance: number;
    alertLevel: 'ok' | 'warning' | 'critical';
  };
  revenue: {
    activeSubscriptions: number;
    mrrCents: number;
    projectedOverageCents: number;
  };
  margin: {
    revenueCents: number;
    costCents: number;
    profitCents: number;
    marginPercent: number;
  };
}

export interface CostBreakdown {
  byCategory: Record<string, {
    base: number;
    markup: number;
    total: number;
    percentage: number;
  }>;
  byService: Record<string, number>;
  trends: {
    date: string;
    total: number;
  }[];
}
```

```typescript
// src/types/jobs.ts

export interface RunPodJob {
  id: string;
  videoId: string;
  jobType: 'transcription' | 'embedding';
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  runpodJobId: string | null;
  gpuType: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  gpuSecondsUsed: number | null;
  estimatedCostCents: number | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  priority: number;
}

export interface DeadLetterMessage {
  id: string;
  originalQueue: string;
  messageType: string;
  payload: Record<string, unknown>;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  replayedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
}

export interface JobMetrics {
  activeJobs: number;
  completedToday: number;
  failedToday: number;
  avgProcessingTimeSeconds: number;
  totalCostTodayCents: number;
}
```

```typescript
// src/types/subscriptions.ts

export interface SubscriptionTier {
  id: string;
  name: string;
  nameAr: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  quotas: TierQuotas;
  features: TierFeatures;
  overageRates: OverageRates;
  isActive: boolean;
  displayOrder: number;
}

export interface TierQuotas {
  storageGB: number;
  uploadMinutesPerMonth: number;
  channelsAllowed: number;
  videosPerChannel: number;
  maxVideoLengthMinutes: number;
  maxFileSizeGB: number;
}

export interface TierFeatures {
  transcription: boolean;
  aiSearch: boolean;
  analytics: 'basic' | 'advanced' | 'full';
  customBranding: boolean;
  priorityProcessing: boolean;
  apiAccess: boolean;
  liveStreaming: boolean;
}

export interface OverageRates {
  storagePerGB: number;
  bandwidthPerGB: number;
  transcriptionPerMinute: number;
}

export interface SubscriptionStats {
  totalUsers: number;
  byTier: Record<string, {
    count: number;
    mrrCents: number;
    avgUsagePercent: number;
  }>;
  mrrCents: number;
  arrCents: number;
  churnRate: number;
  growthRate: number;
}
```

```typescript
// src/types/infrastructure.ts

// === Hetzner Types ===

export interface HetznerServer {
  id: number;
  name: string;
  status: 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'rebuilding' | 'migrating' | 'unknown';
  publicNet: {
    ipv4: { ip: string };
    ipv6: { ip: string };
  };
  serverType: {
    name: string;
    description: string;
    cores: number;
    memory: number;
    disk: number;
    prices: { location: string; priceHourly: { gross: string }; priceMonthly: { gross: string } }[];
  };
  datacenter: { name: string; location: { name: string; city: string } };
  image?: { name: string; description: string };
  labels: Record<string, string>;
  created: string;
  outgoingTraffic?: number;
  ingoingTraffic?: number;
}

export interface HetznerAction {
  id: number;
  command: string;
  status: 'running' | 'success' | 'error';
  progress: number;
  started: string;
  finished?: string;
  error?: { code: string; message: string };
}

export interface HetznerMetrics {
  start: string;
  end: string;
  step: number;
  timeSeries: Record<string, { values: [number, string][] }>;
}

export interface HetznerPricing {
  currency: string;
  serverTypes: {
    id: number;
    name: string;
    prices: { location: string; priceHourly: { gross: string }; priceMonthly: { gross: string } }[];
  }[];
  traffic: { pricePerTb: { gross: string } };
}

export type HetznerServerAction = 'poweron' | 'poweroff' | 'shutdown' | 'reboot' | 'reset';

// === RunPod Types ===

export interface RunPodPod {
  id: string;
  name: string;
  desiredStatus: 'RUNNING' | 'STOPPED' | 'TERMINATED';
  lastStatusChange: string;
  costPerHr: number;
  uptimeSeconds: number;
  machine?: { gpuDisplayName: string; podHostId: string };
  runtime?: { gpus: { id: string; memoryUtilization?: number; gpuUtilization?: number }[] };
}

export interface RunPodEndpoint {
  id: string;
  name: string;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  templateId: string;
  gpuIds: string[];
}

export interface RunPodBilling {
  currentSpendPerHr: number;
  clientBalance: number;
  spendDetails: {
    podSpend: number;
    gpuCloudSpend: number;
    serverlessSpend: number;
    storageSpend: number;
  };
}

export interface RunPodGpuType {
  id: string;
  displayName: string;
  securePrice: number;
  communityPrice: number;
  memoryInGb: number;
  maxGpuCount: number;
}

export type RunPodPodAction = 'stop' | 'resume' | 'terminate';

// === Unified Infrastructure Types ===

export interface InfrastructureOverview {
  hetzner: {
    servers: HetznerServer[];
    totalMonthlyCost: number;
  };
  runpod: {
    pods: RunPodPod[];
    billing: RunPodBilling;
    monthlyCostEstimate: number;
  };
  totalMonthlyCost: number;
  breakdown: {
    hetzner: number;
    runpod: number;
    runpodBalance: number;
  };
}

export interface InfrastructureServer {
  id: string;
  provider: 'hetzner' | 'runpod';
  providerId: string;
  name: string;
  purpose: 'streampot' | 'whisper' | 'general';
  status: string;
  ipAddress?: string;
  serverType?: string;
  location?: string;
  hourlyCost?: number;
  monthlyCost?: number;
  createdAt: string;
  lastHealthCheck?: string;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown' | 'stopped';
}

export interface InfrastructureAction {
  id: string;
  serverId: string;
  action: string;
  status: 'pending' | 'running' | 'success' | 'error';
  initiatedBy: string;
  initiatedAt: string;
  completedAt?: string;
  errorMessage?: string;
  providerActionId?: string;
}
```

---

## Appendix B: Environment Variables

```typescript
// cloudflare-env.d.ts

interface Env {
  // D1 Database
  ADMIN_DB: D1Database;

  // KV Namespaces
  ADMIN_SESSIONS: KVNamespace;
  ADMIN_CACHE: KVNamespace;

  // R2 Buckets (read-only)
  PROFILES: R2Bucket;
  CHANNELS: R2Bucket;
  VIDEOS: R2Bucket;

  // Service Bindings
  API_VIDEOS: Fetcher;

  // Queues
  AUDIT_QUEUE: Queue;

  // Assets
  ASSETS: Fetcher;

  // Environment Variables
  ENVIRONMENT: 'development' | 'staging' | 'production';
  API_URL: string;
  ADMIN_EMAIL_DOMAIN: string;

  // Infrastructure API Credentials (Secrets)
  HETZNER_API_TOKEN: string;
  RUNPOD_API_KEY: string;
  RUNPOD_ENDPOINT_ID: string;
  STREAMPOT_API_KEY: string;
  STREAMPOT_BASE_URL: string;
  R2_ENDPOINT: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY: string;
  R2_SECRET_KEY: string;
  WEBHOOK_URL: string;
}
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-25 | System Architect | Initial specification |
| 1.1 | 2025-11-25 | System Architect | Added RunPod/Hetzner infrastructure automation |

---

## Related Documents

- [Analytics Dashboard Architecture](./analytics-dashboard-architecture.md)
- [Infrastructure Orchestration](./infrastructure-orchestration.md) - RunPod/Hetzner API clients and automation
- [Main CLAUDE.md](../../CLAUDE.md)
- [API Videos CLAUDE.md](../../apps/api-videos/CLAUDE.md)
