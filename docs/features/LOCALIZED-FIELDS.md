# Localized staff-set fields (L10N rule)

Owner rule (2026-11-16): "Everywhere, if there is a field that is localizable, then either the admin
has to set it, or you provide a translation service from one to the other; only exception is users'
content." User content (videos, posts, comments, playlists, channel and profile text, a scholar's
own bio) is out of scope.

## Behaviour

- Both languages are first-class. Saving with one missing is a validation error, in the API and
  inline in the form. No "leave empty to use the one above" hints and no silent fallback when rendering.
- Every en/ar pair has a **Translate** button in each direction. The suggestion fills the other field,
  stays editable, and never overwrites a non-empty field without an Undo (in-app, never a browser prompt).
- List pages flag legacy rows with "Arabic missing" / "English missing", filter by them, and offer a
  batch **Translate missing**: the suggestions are shown for review; nothing is saved unseen.

## Translate service

`POST /api/translate/fields` on admin-api (`apps/admin-api/src/routers/translate.router.ts`):

```json
{ "from": "en", "to": "ar", "texts": ["News", "Shorts"], "field": "categories.label" }
→ { "success": true, "result": { "items": [{ "text": "…", "cached": false }, { "text": "", "refused": "quran", "quran": [{ "range": "…", "label": "…" }] }],
    "provider": "workers-ai", "machineTranslation": true, "usage": { "used": 2, "limit": 500, "resetsAt": "…" } } }
```

- Staff only: permission `content:translate` (admins and super admins). At most 50 texts, 5,000
  characters each, 20,000 in all. `field` is `<feature>.<field>` (audit and cache key).
- admin-api → api-videos `POST /internal/translate/admin-fields` (`lib/translate/admin-fields.ts`) →
  processor `POST /internal/translate` with `mode: 'admin_field'` (`src/captions/admin-fields.ts`).
- Reuses the creators' inline translation path: the admin kill switch (`translation_paused`), the
  day's share of the inline budget (`budget_spent`), the edge cache and `translation_audit`
  (kind `inline`, field `admin:<field>`; who, languages, counts, never the text).
- Its own cap: 500 texts per staff member per UTC day (`429 daily_limit`), counted in
  `inline_translation_usage` under `staff:<userId>`; cache hits are free and viewers' fair use is untouched.
- Workers AI only (never DeepL), English ↔ Arabic only. The prompt adds the site's wording
  (`SITE_COPY_RULES`: «مرئي/مرئيات», «المقاطع القصيرة», placeholders kept) and the CMS glossary entries
  that occur in the text, read from the CMS `GET /internal/glossary` (the one glossary; cached 5
  minutes, translated without it when the CMS is unreachable). Placeholders (`{name}`, `{{count}}`,
  `%s`) travel as tokens and come back unchanged.
- Quran is never machine-translated. A text is refused (`refused: 'quran'`, empty text, references
  when found) when it has mushaf marks (﴿ ﴾ ۝, small high signs), a `{…}` quotation in Arabic, an
  Arabic span the Quran matcher confirms, or when the model says it is a verse or a translation of
  one. The admin pastes the official text and a recognised translation instead.
- Tests use the fixture or a scripted translator; the real Workers AI translator throws under
  test, CI and E2E (`assertRealAiAllowed`).

## Admin UI

- `components/localized/LocalizedFieldPair.tsx`: the labelled pair (English | العربية, each with
  `lang`/`dir`), Translate in both directions, Undo when a translation replaced text, a polite live
  status, errors tied to each input. `MissingLanguageBadge` flags rows.
- `components/localized/TranslateMissing.tsx`: "Translate missing (n)" for a list, then a review of
  every suggestion (editable) with Save / Discard; `MissingFilterSelect` for list filters.
- Pure helpers: `lib/localized.ts`.

## Fields (2026-11-16 sweep)

| Field | Save rule (API + form) | Legacy rows | Public rendering |
|---|---|---|---|
| Video category name (`video_categories.label_en/label_ar`) | Both required (shared-types `validateCategoryFields`); form uses the pair | Badge on the row; "Translate missing" above the list when a row lacks one (no filter: the list is short and ordered by hand) | One language only, no fallback (web Explore, search, upload picker) |
| Status incident title and update message (`incidents.title_*`, `incident_updates.body_*`) | Both required (`parseIncidentInput`); form uses the pair | None possible (always required) | status site and emails show the reader's language only |
| Newsletter issue subject and text (`newsletter_issues.subject_*`, `body_*`) | A **draft** may be saved with a language missing (never shown to anyone); **Send** needs all four (API `missingForSend` + form) | Badge on the issue list | Each subscriber gets one language; never a fallback |
| Theme name and description (`theme_packages.name_*`, theme.json `name`/`description`) | Name required in both; description in both or neither (`localizedProblems`, 422). Saving an empty name no longer keeps the old one silently | Rows always have both names (create requires them) | Not public; Studio shows the creator's language |
| Creator tier name | Owned by the SUBS stack (#1443): wired separately | | |

Not staff-typed, so out of scope: entitlement descriptions, site tier seeds, status components, help
content and built-in themes (both languages in the repo); UI translations (per-language overrides of
the same key); upload templates (creator content).
