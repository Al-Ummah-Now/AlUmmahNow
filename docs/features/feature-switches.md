# Feature switches

The videos admin **Features** page turns platform features on and off for everyone, enforced by the
servers (wiki `epics/AUN-FEATURES-feature-switches.md`, decision O39).

## Pieces

| Piece | Where |
|---|---|
| Registry: keys, groups, en/ar names and help, defaults, who may toggle, requirements, setup notes | `packages/shared-types/src/feature-registry.ts` |
| Storage: `feature_switches`, `feature_switch_changes` (search D1, migration 0077), read/write/history | `packages/shared-types/src/feature-switch-store.ts` |
| Old settings follow the switch (captions settings, YouTube import, social, categorize visibility, tier requests) | `apps/api-videos/src/lib/features/switches.ts` (`overlaySwitch`, `syncLegacySwitch`) |
| `/api/me/features` ANDs the effective switches in; ETag + 304 | `apps/api-videos/src/lib/features/index.ts`, `endpoints/creator/features.ts` |
| Old settings and set-up state for the page | api-videos `GET /internal/admin/features/state` |
| Page API: list, change, history; permissions, super admin, preconditions, audit | `apps/admin-api/src/routers/features.router.ts` |
| Conditions to turn a switch on | `apps/admin-api/src/lib/feature-preconditions.ts` |
| `/public/features` (www) follows the newsletter switch | `apps/admin-api/src/lib/public-features.ts` |

## Values

- **Stored**: the switch's row; with no row, its old setting (the registry's `legacy` source); else
  the registry default. The first write creates the row; from then on the old setting is not read
  (an old page's own toggle moves the row too, source `legacy_page`, until the Features page
  replaces it).
- **Effective**: stored, every required switch on (`requires`), and not forced off by
  `FEATURES_FORCE_OFF` (`all` or a comma list; local stack and E2E only).

## Old pages keep the switch's rule

A super-admin-only switch with an old setting can't be changed by a plain admin on its old page
either: `PUT /api/content/captions/settings` refuses a change to `viewerDownload.enabled`
(viewer caption download) without super admin (403 `forbidden`, `feature` named); unchanged values
pass. The list comes from the registry (`toggle: 'superAdmin'` with a `captions.` legacy path).

## How fast

Rows are memoised per isolate for 30 s, so every server refuses within 30 s; every app follows
within 2 minutes (`/api/me/features` signed out is `public, max-age=30`, signed in revalidates
with its ETag). A write clears the memo in the isolate that made it.

## API (admin-api)

| Route | Permission | Notes |
|---|---|---|
| `GET /api/features` | `features:read` (admins, super admins, moderators) | `items[]`: `key, enabled, effective, blockedBy, ready, setupNote, envOverride, parked, version, updatedAt, updatedBy{id,name}, canToggle`; `canManage`, `stateAvailable`, `propagationSeconds` |
| `PUT /api/features/:key` | `features:manage` (admins, super admins); super admin for `toggle: 'superAdmin'` | `{ enabled, expectedVersion, undo? }` → `{ previous, enabled, version }`. Stale version: 409 `feature_changed` with `current`. Precondition fails: 409 `feature_precondition` with `message` (caller's language) and `reason {en, ar}` |
| `GET /api/features/:key/history?cursor=` | `features:read` | `items[]`: `id, version, oldEnabled, newEnabled, actor{id,name}, source, createdAt`; 50 per page, `nextCursor` |

Every change is audited in `site_settings_log` (key `feature:<key>`, action `feature.switch`;
Audit page area Settings).

## Adding a switch

1. Add the key to `FEATURE_KEYS` and its entry to `FEATURE_REGISTRY` (en/ar text, default, toggle,
   confirm, requires, `userFeatureKeys`); a setup note in `FEATURE_SETUP_NOTES` if it needs setup.
2. If it has an old setting, name it in `legacy` and make that reader call `overlaySwitch`.
3. If turning it on needs a condition, add a check to `FEATURE_PRECONDITIONS`.
4. Gate its routes (FEAT-2) and its background work (FEAT-5).
