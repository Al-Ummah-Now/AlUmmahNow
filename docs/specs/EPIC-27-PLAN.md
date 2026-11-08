# Epic 27: plans & entitlements, implementation plan

**Spec:** `docs/specs/EMBEDS-COMMENTS-TIERS.md` §5 (Epic 27). **Issue:** #262.
**Related:** `docs/embeds/PLAN.md` (D12: v1 embeds consult no entitlement), `docs/native-apps/EPICS.md` Epic 24 and D4 (monetisation: none at launch).

## 1. Scope

**In scope (plumbing):** plans, plan versions, per-plan entitlement values, the entitlement catalogue, admin assignment, overrides, trials by expiry date, resolution, server-side enforcement, usage counters, audit trail, and the admin and user UIs.

**Not in this plan, pending the owner (§10, Q1):** anything that takes money. That means `plan_prices`, `payment_providers`, `payment_events`, the `PaymentProvider` interface and adapters, checkout, `/api/billing/webhooks/*`, App Store / Google Play IAP, and any displayed price. Spec 27.1 and 27.7 describe these; D4 says "None at launch". They add tables later without changing anything below.

### Invariants

1. **No existing user or channel changes behaviour.** A subject with no assignment is on the default plan, and the default plan grants everything that works today.
2. **No backfill.** "On the default plan" is the absence of a `subscriptions` row, so there is no data to rewrite.
3. **Checks are server-side.** UI hints are only hints.
4. **Fail to today's behaviour.** If D1 or KV is unavailable, resolution returns the code defaults and logs a warning. An outage must not lock creators out.
5. **Never break a live embed.** Lowering a limit blocks new additions only; existing items keep working (27.5).

## 2. What exists today

| Item | State |
|---|---|
| `apps/api-videos/src/lib/entitlements.ts` | Declares 5 keys and `FREE_DEFAULTS`. Nothing imports them. |
| `channel.about.links.max` | Hard-coded: `MAX_CHANNEL_LINKS = 10` in a Zod schema (`lib/model/input.ts`). |
| `REPORTS_DB` (D1) | Owned by admin-api, `apps/admin-api/migrations/`, migrated in QA by `deploy.yml` and in stage/prod by `scripts/release/d1-migrate.ts`. |
| `RATE_LIMIT_KV` | Bound on api-videos. admin-api has no KV binding. |
| admin-api auth | `adminMiddleware` admits admins and moderators; roles are normalised to snake_case. |
| Epics 25/26 | Shipped with no gated keys: `sites`, domain allowlists, custom colours, guest posting and comment writes through the widget do not exist yet, so those keys have nothing to enforce. |

## 3. Data model

New migrations in `apps/admin-api/migrations/` (same `REPORTS_DB`, so no new database in three environments), append-only, with `pnpm schema:snapshot` committed alongside. api-videos gets a `REPORTS_DB` binding in `wrangler.qa.jsonc` and in `wrangler.jsonc` (top level and stage), plus the matching `scripts/release/apps.ts` entries. api-videos reads these tables and writes only through the admin-api-owned paths in §4.

`0002_plans_entitlements.sql`:

```sql
plans (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL, description_en TEXT, description_ar TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('creator','organisation','viewer','everyone')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,          -- latest published version
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_plans_one_default ON plans(is_default) WHERE is_default = 1;

plan_entitlements (
  plan_id TEXT NOT NULL REFERENCES plans(id),
  plan_version INTEGER NOT NULL,
  key TEXT NOT NULL, value_json TEXT NOT NULL,
  PRIMARY KEY (plan_id, plan_version, key)
);

subscriptions (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('channel','organisation','user')),
  subject_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id), plan_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','expired')),
  current_period_start TEXT, current_period_end TEXT,
  provider TEXT NOT NULL DEFAULT 'manual', provider_subscription_ref TEXT,
  assigned_by TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_subscriptions_live ON subscriptions(subject_type, subject_id)
  WHERE status IN ('trialing','active','past_due');

entitlement_overrides (
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  key TEXT NOT NULL, value_json TEXT NOT NULL, expires_at TEXT,
  reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (subject_type, subject_id, key)
);

usage_counters (
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, key TEXT NOT NULL,
  period TEXT NOT NULL,                        -- 'YYYY-MM', or 'all' for totals
  value INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id, key, period)
);

plan_audit_log (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT NOT NULL
);
```

The spec's `is_default` is an addition: it lets the default be data, as T1 requires, with the partial index allowing only one. `organisation` is in the CHECK now because no organisation entity exists yet and SQLite cannot alter a CHECK without a table rebuild.

**Values:** `value_json` holds a JSON boolean, number, enum string or list. A numeric limit with no ceiling is the string `"unlimited"`.

`0003_seed_default_plan.sql`: one `INSERT OR IGNORE` for plan `free` (`active`, public, default, version 1), plus its entitlement rows. **Free's seeded values are today's behaviour**, which differs from the spec's suggested Free limits on anything already unlimited:

| Keys | Seed | Why |
|---|---|---|
| `channel.about.links.max` | 10 | Today's hard limit |
| `channel.handle`, `comments.*`, `share.shortLinks`, `embed.enabled` | true | Available to all today |
| `channel.max`, `upload.maxDurationMinutes`, `upload.monthlyHours`, `storage.gb`, `live.monthlyMinutes` | `"unlimited"` | No limit today. The spec names these keys but gives no value |
| Unbuilt-feature keys (`sites.max`, `discussions.*`, `embed.domains.max`, ...) | spec §27.4 Free column | Nothing to preserve; the feature adopts the key when built |

Plus, Pro and Institution are seeded as `draft`, non-public, with the §27.4 values, for admins to edit.

**Data check:** `scripts/release/` gets no new gate; PR 1's test applies the migrations to an empty SQLite and asserts exactly one default plan, and that every catalogue key has a Free row. After the QA deploy, the same two assertions run as `SELECT`s against QA D1.

## 4. Catalogue, resolution and API

**Catalogue** moves to `packages/shared-types/src/entitlements.ts`: key, type (`boolean|number|enum|list`), unit, code default, `description_en/ar`, owning epic, behaviour at limit. It is the source of truth. "Synced" (27.6) is met by importing it in admin-api and admin-web, so admins can only pick valid keys and no catalogue table can drift. `api-videos/src/lib/entitlements.ts` is replaced by a re-export plus the resolver.

**Resolution** (one pure function, unit-tested), highest priority first:

1. Unexpired `entitlement_overrides` row.
2. The live `subscriptions` row's `plan_id` + `plan_version`. `past_due` still counts, as the grace state. A `trialing` row whose `current_period_end` has passed is ignored.
3. The default plan at its latest version.
4. The catalogue's code default.

A key absent from a plan falls through to the next level.

**Cache:** KV at `entitlements:v1:{type}:{id}` with a 60 s TTL. admin-api gets a binding to the same namespace and deletes the key on every write (bulk migrations rely on the TTL). Only gated write paths read it, never views or playback, so KV cost is negligible against the $500/month cap.

**api-videos**
- `GET /api/entitlements?subject=channel:{id}|user:{id}` → `{ subject, plan: { slug, name_en, name_ar }, entitlements, usage }`. Requires auth; the subject must be the caller or a channel the caller owns (admins may read any). Otherwise 403.
- `requireEntitlement(key)` and `checkLimit(key, n)` as helpers callable after the subject is known (the channel id comes from the body or route). At the limit: HTTP 402, `{ success: false, error: "upgrade_required", entitlement, limit, current, requiredPlan?, message }`, with `message` from i18n in en/ar.

**admin-api** (new router `/api/plans`, its own guard; moderators get no access)
- Plans: list, get, create, clone, update draft, publish (bumps version, writes new `plan_entitlements`), archive, diff of two versions. The default plan cannot be archived.
- Assignments: list, assign / trial, cancel, bulk migrate to a version (`dryRun` by default, returns the affected count).
- Overrides: list, set, remove. Usage by subject. Audit log (read).
- Every write validates against the catalogue, writes `plan_audit_log` in the same D1 batch, and requires a `reason` on assignments and overrides.

**RBAC:** add `billing_admin` (write) and `billing_viewer` (read) to `roles.ts` in admin-api and admin-web; `admin` and `super_admin` are also allowed. The roles must also be created on the auth server (separate repo) before anyone can hold them (§10, Q3).

## 5. Enforcement points

| Key | Where | At limit |
|---|---|---|
| `channel.about.links.max` | Channel update: the Zod cap stays as an absolute ceiling raised to the catalogue maximum; the per-channel limit is checked in the handler | 402 (was 400); the settings UI stops adding rows |
| `comments.replies`, `comments.settings`, `comments.heldForReview` | Comment create; per-video comment settings | 402 |
| `channel.max` | `channelCreate` (user subject) | 402; existing channels untouched |
| `upload.maxDurationMinutes`, `upload.monthlyHours` | TUS proxy create / upload start | 402 before bytes are sent |
| `share.shortLinks`, `embed.enabled` | Short-link and embed routes, read from the same resolver; must fail open | Embed keeps playing (Invariant 5) |

Web changes to `links.max` must accept both 400 and 402 while the deploy rolls out. Keys for unbuilt features (`sites.*`, `discussions.*`, `embed.customColor`, ...) are catalogued and adopted by those features (Definition of Done addition, 27.2). Any that have no owning issue get a `queue` issue.

## 6. Metering

`upload.monthlyHours` and `storage.gb` first, since only those have a real event source. api-videos sends a `usage.increment` queue message; the processor (needs a `REPORTS_DB` binding, added with its `apps.ts` entry) upserts `usage_counters`. Messages carry an id, recorded for idempotence, so a retry does not double-count. Checks read the cached value. `usage` in the API reports `warning: true` at 80%; hard stop at 100%. With the seed at `"unlimited"`, nobody is affected until an admin sets a limit.

## 7. Admin UI (`apps/admin-web`)

New nav section **Plans**, hidden unless the role allows it, en/ar + RTL, TanStack Query, under `(protected)/plans`:

- `plans`: list and status. `plans/[id]`: editor (bilingual fields, catalogue-driven value inputs, publish with confirm, version diff, clone).
- `plans/assignments`: find subject, assign, trial with expiry, overrides, bulk migrate with dry-run count and confirm.
- `plans/usage`: usage vs limits. `plans/audit`: who, when, why.

Provider management and prices (27.6) wait on Q1.

## 8. User UI (`apps/web`)

- `useEntitlement(key, subject)`, backed by a server action calling `GET /api/entitlements`. A failed fetch means allowed; the server still enforces.
- `<PlanGate>` for disabled controls with "Available on {plan}". A shared handler turns 402 `upgrade_required` into a localized message.
- `/[locale]/settings/channel/[id]/plan`: read-only current plan, limits and usage, with an 80% warning. No prices, no checkout, no upgrade button (Q2).
- Links editor in channel settings reads the limit instead of the constant. en/ar keys, logical CSS properties for RTL, and the repo's LTR/RTL component pattern where the surrounding component uses it.

## 9. Delivery and tests

Each PR is small, off fresh `origin/main`, and merges only with required checks green.

| PR | Contents | Tests |
|---|---|---|
| 1 | Migrations 0002/0003, snapshot, shared catalogue, resolver (pure) | Migration applies on empty SQLite; one default; every key seeded; full resolver precedence (expiry, trial end, version pinning, fall-through) |
| 2 | api-videos binding, KV cache, `GET /api/entitlements`, helpers | `apps/api-videos/test/entitlements.spec.ts`: authz (owner, stranger, admin); **no row → today's values**; D1 down → defaults; 402 shape in en/ar |
| 3 | Enforcement of existing keys (§5) | Each key: default plan passes as before; an override below usage returns 402; raising via override allows more than today |
| 4 | admin-api router, RBAC, audit, KV invalidation | Moderator / plain user 403; catalogue validation; publish bumps version and pins subscribers; default not archivable; every write audited; bulk dry-run writes nothing |
| 5 | admin-web Plans UI | Component tests; release E2E `plans-admin.spec.ts`: promoted admin creates and publishes a plan, en and ar |
| 6 | web hook, gate, plan page, links limit | Component tests including RTL; release E2E `plan-entitlements.spec.ts`: new user sees Free; after an admin override, a save over the limit shows the upgrade message, and an unassigned channel still saves 10 links |
| 7 | Metering (queue → processor), usage in API and UIs | Processor idempotence; 80% and 100% boundaries |

QA verification after each deploy: `/api/entitlements` for a fresh channel returns Free with today's values, the D1 assertions in §3, and the admin page in en and ar.

Release E2E specs keep to the suite's constraints: own sink user, imports inside `e2e/release/`, never production.

## 10. Open questions for the owner

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Should Epic 27 now include any payment work (prices, providers, checkout, webhooks, IAP)? D4 says none at launch; the spec's Phase 5 includes it. | Excluded |
| Q2 | With no billing, what does "Available on Pro" lead to? | Plain text, no link |
| Q3 | `billing_admin` / `billing_viewer` need creating on the auth server. | `admin` and `super_admin` only until then |
| Q4 | Should real limits on uploads, storage or channel count ever apply to Free? | `"unlimited"`, changeable by an admin with no deploy |
