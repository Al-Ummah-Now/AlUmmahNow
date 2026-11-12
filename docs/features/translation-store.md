# Translation store and repo text

The web app's UI strings live in the repo (`packages/shared-types/src/i18n-static/{en,ar}.ts`).
Each environment also has an editable **translation store**: api-videos' `global_settings` R2
bucket, `translations/{en,ar}.json` plus `translations/metadata.json`. Admins edit it on the
admin Translations page (admin-api `PUT /api/i18n/translations/:locale`), and api-videos serves
it (`GET /api/i18n/translations/:locale`).

## Which text wins (#982)

Each stored locale file lists the keys an admin edited in `overrides` (dotted leaf paths, such
as `a11y.goToHomePage`). **Only those keys win over the repo.** Every other key is served from
the repo, so a string changed in the repo reaches every environment when it deploys. You never
need to touch the store.

| Where | What it does |
|---|---|
| api-videos `GET /api/i18n/translations/:locale` | Returns its build's repo text with the `overrides` keys taken from the store, plus the `overrides` list. The ETag includes a fingerprint of the repo text, so a deploy invalidates cached copies. |
| web `useTranslationsQuery` | Takes only the `overrides` keys over its own bundled repo text. A web deploy shows new repo text even before api-videos deploys. |
| admin-api save | Adds each saved key to `overrides`. Saving a key back to its repo value removes it, which hands the key back to the repo. |
| api-videos `POST /api/i18n/sync` | Rewrites the store from the repo and keeps the `overrides` keys. |
| `scripts/release/seed-translations.ts` (deploy / release) | Creates missing files with an empty `overrides` list. It never rewrites existing files. |

The helpers are in `packages/shared-types/src/i18n-overrides.ts`.

A file without `overrides` was written before #982 (a "legacy" file). It is served exactly as
stored, and its first admin save treats every key that differs from the repo as edited, so
nothing changes behaviour silently.

Alternative considered: storing only the admin edits (a diff) instead of a full copy plus a
list. Rejected because admin-web, older api-videos builds and external readers all expect a full
file, and the list gives the same result without a format break.

## Repairing a legacy store

`scripts/release/repair-translation-store.ts` gives a legacy file its `overrides` list. For each
key that differs from the repo:

- **Stale:** the stored value is one the repo itself once had (the script reads the repo text at
  every commit from git history). The script updates it to the repo text, or drops it if the repo
  no longer has the key.
- **Admin-edited:** any other value. The script keeps it and lists it.

```bash
pnpm exec tsx scripts/release/repair-translation-store.ts --env qa|stage|production            # dry run
pnpm exec tsx scripts/release/repair-translation-store.ts --env qa --apply
pnpm exec tsx scripts/release/repair-translation-store.ts --env production --apply --allow-production   # only after the owner approves the dry run
```

It needs full git history and a Cloudflare token (`CLOUDFLARE_API_TOKEN` or `wrangler login`).
It refuses to write if a locale file changed after it was read.

Run 2026-11-12: QA and stage were applied (en 9, ar 10 stale keys, 0 admin edits). Production's
dry run gave the same 9 + 10 stale keys and 0 edits; the production apply waits for the owner's
approval.
