# Transcription, translation and inline metadata translation (Quran-aware)

**Status:** Draft v1 for review
**Date:** 2026-11-11
**Epic:** new, proposed as `AUN-CAPTIONS` (relates to Epic 8 video content features, Epic 18/19 native Studio, Epic 27 entitlements, Epic 28 moderation, wiki decision D10)
**Research and measurements:** [docs/research/TRANSCRIPTION-TRANSLATION-RESEARCH.md](../research/TRANSCRIPTION-TRANSLATION-RESEARCH.md). Section numbers written `R§n` refer to it.
**Related:** subtitles API (`apps/api-videos/src/endpoints/video/subtitles*.ts`), Epic 27 plan (`EPIC-27-PLAN.md`), CMS AI provider layer (AlUmmahNowCMS `src/lib/ai/`, `docs/AI_ASSIST_SPEC.md`), AI moderation (`AI-MODERATION.md`)

The owner asked for:
- transcription and translation of videos, on demand only (never automatic), metered by tier or add-on, with admin grants;
- inline translation of titles and other metadata, to and from any language, with en↔ar first;
- Quran-aware output: detected Quran is replaced by the official text and official translations.

---

## 1. Decisions in one page

| Topic | Recommendation | Why (evidence) |
|---|---|---|
| Speech-to-text default | **Workers AI `@cf/openai/whisper-large-v3-turbo`**, VAD off, explicit language, `initial_prompt`, chunks of 10 minutes or less | $0.00051/min measured. It matched or beat Bunny on every test clip. VAD deleted speech in 2 of 3 cases (R§2). |
| Speech-to-text fallback | **ElevenLabs Scribe v3** ($0.20/h), admin-enabled, for "high accuracy" jobs and when the default fails | Best-documented Arabic and dialect results, and cheap. **Not measured yet**: needs the key (owner decision O1). |
| Not used | Bunny built-in transcription ($0.10 per language-minute, Whisper-based, no glossary); Cloudflare Stream captions (no Arabic); Workers AI nova-3 (no Arabic); Media Transformations audio extraction ($0.03/min, 10-minute limit) | R§2, R§5 |
| Transcript translation | **DeepSeek V4.1 Flash** on Workers AI, falling back to Gemma 4 26B | Cue-accurate and honorific-correct at $0.0004 per video-minute. It is already the CMS default (R§3.2). |
| Inline title/description translation | **Gemma 4 26B** on Workers AI, falling back to DeepSeek V4.1 Flash. DeepL is an optional adapter. | p50 1.0 s, p95 2.1 s, $0.00002 per title, quality equal to DeepSeek (R§3.1) |
| Never | m2m100 (unusable: invented hadith, repetition loops), gpt-oss (answers instead of translating) | R§3.1, CMS §1.5 |
| Quran text | **Tanzil Uthmani 1.1**, stored offline, verbatim, credited | CC BY 3.0 allows offline storage. Quran Foundation's terms forbid a static cache (R§5). |
| Quran translations | **QuranEnc** editions per language, stored offline: English `english_saheeh` (Noor International) by default, `english_rwwad` as the alternative | Republishing allowed with attribution and version. The Clear Quran and other Saheeh sources need written permission. |
| Metering | One "caption minute" per video-minute per language produced; plan allowance plus add-on packs plus admin grants | §6 |
| Inline title translation | **Free on every tier, with a fair-use cap** | 100,000 title translations cost about $2 (§6.4) |
| Cost at scale | 1,000 h/month of jobs ≈ **$58** with the default stack; 10,000 h ≈ $578, which breaks the cap, so it is bounded by tier minutes and a budget stop | §7 |

## 2. Principles

1. **On demand, never automatic.** Nothing is transcribed or translated unless a creator (or an admin acting for them) asks. The "transcribe after processing" upload flag counts as asking.
2. **Never silent.** Machine output is a **draft** until the creator publishes it. Inline translations are **suggestions** in the form. Machine text shown to viewers is labelled.
3. **Quran is never machine-translated.** Detected Quran is shown in the official Uthmani text, and its translation is a recognised edition with attribution.
4. **Workers AI first.** Third-party providers are pluggable adapters. An admin turns them on per environment, and their keys live in Secrets Store (product constraints).
5. **Tier-aware.** Every limit is an Epic 27 entitlement key edited in admin-web. Nothing is hard-coded.
6. **Inside the $500/month cap.** A hard monthly budget per environment stops spending and queues work. It never fails jobs silently.
7. **Arabic and English parity.** Every UI string, error and notification exists in en and ar, RTL-correct.

## 3. User experience

### 3.1 Creator: transcripts and subtitles (web Studio, then native Studio)

- **Where:** Studio → video → **Subtitles** tab. This extends the existing `SubtitleUploadSection`.
- **Language list:** each language shows its status: none, *Transcribing…*, *Draft*, *Published*, *Failed*. Manually uploaded tracks keep working as they do today.
- **Actions**
  - **Transcribe**
    - The spoken language is picked from the video's `language`, with the option to change it.
    - Optional **Also translate to** chips. en/ar are offered first; the full list is admin-configured.
    - A cost line before confirming: "This uses 34 of your 120 remaining caption minutes (17 min × 2 languages)."
  - **Translate:** shown once a source transcript exists. Always uses the creator's corrected source (§5.7).
  - **Edit:** opens the transcript editor (§3.3).
  - **Publish / Unpublish** per language.
  - **Delete track.**
- **Upload form flag:** "Generate subtitles after processing" plus target languages, so a single upload doesn't need the editor.
  - Batch "Set values" (`BatchSetValuesPanel`) gets the same flag for every queued file.
  - The minutes are **reserved when the upload completes and charged when the job finishes**. If the reservation fails because of the plan limit, the video still uploads; the creator sees "Subtitles not started: monthly caption minutes used" with an upgrade link.
- **Studio bulk actions** (Content → Videos, selection): "Transcribe", and "Translate subtitles to…". The dialog shows the total minutes and refuses the whole batch with a clear message if it doesn't fit. There are no partial surprises.
- **Usage meter:** "Caption minutes: 86 / 120 this month · resets 1 Dec · +500 add-on". It appears in Studio → Subtitles, Studio → Settings → Plan, and in the confirm dialogs. A warning shows at 80%.
- **Progress and failures**
  - **Live progress:** a status chip with a step: *Preparing audio*, *Transcribing 3/7*, *Checking Quran*, *Translating*. Updates come over the existing websocket channel, with polling as a fallback.
  - **When it finishes:** an in-app notification "Arabic subtitles ready to review".
  - **On failure:** a friendly en/ar message with a reference, and **minutes refunded automatically**. The failure is recorded through `reportNeedsAction` with a retry spec, as in error-reporting.md.
- **Hard stop:** HTTP 402 `upgrade_required` with entitlement `captions.monthlyMinutes`. The UI shows the plan, the remaining minutes, add-on packs and the "contact admin" path. Partial jobs are never started.

### 3.2 Viewer

- **Player:** published machine tracks appear in the existing captions menu as "العربية (تلقائي)" / "English (auto)".
- **Quran cues** carry a reference chip, e.g. «آل عمران ١٦٦–١٦٧» / "Āl ʿImrān 3:166–167". The translation is followed by the edition name, e.g. "(Saheeh International)".
- **Attribution:** the watch page's "Subtitles" disclosure lists the Quran text and translation sources with version (§9.4).

### 3.3 Transcript editor (web Studio first; native later)

- **Layout:** cue list with timestamps beside the video, plus waveform scrubbing. Click a cue to seek.
- **Editing:** edit text, merge or split cues, nudge start and end by ±0.1 s. There is undo/redo, and drafts autosave per version.
- **Quran detections** are shown inline as a highlighted range with a chip such as `Quran 3:166–167 · 95%`. Actions:
  - **Accept:** the text becomes the official Uthmani text, which then can't be edited, only rejected.
  - **Reject:** keep the ASR text.
  - **Change reference:** a search picker over surah/ayah, using the autocomplete standard.
  - **Mark selection as Quran:** for short quotes below the detection threshold.
  - Ambiguous matches (the same words in more than one place) show "Appears in 7:59, 7:65, 7:73 …", and the creator picks one.
  - Low-confidence matches show "Possible Quran" and are never pre-accepted.
- **Glossary hints:** terms from the channel glossary are underlined when the ASR spelling differs, with one-click fix (§8).
- **Find and replace across the transcript.**
- **Publish:** writes the VTT and marks the track published. Translations made from an older source version show "Source changed: retranslate (uses N minutes)" or "Keep".
- **Accessibility:** fully keyboard-operable, with `dir` per cue and Arabic text with bidi isolation.

### 3.4 Inline metadata translation (second track)

**Fields, in order:** titles (P0), then descriptions, tags, playlist names and community posts. Videos already have `titleLocalized` and `descriptionLocalized` with `en`/`ar`.

**Creator flow**
- **The button:** a **Translate** button (icon plus label, en/ar) sits next to every title and description field in:
  - the upload form (single upload and "Set values"),
  - the Studio editor (`videoEdit`),
  - the playlist editor,
  - the community post composer.
- **What it does:** it fills the *other* language field with a **suggestion**, styled as unsaved, with a "Machine translation: review before saving" hint.
  - It never overwrites text the creator typed. If the target field isn't empty it asks: "Replace" / "Keep mine".
  - Nothing is saved until the creator saves.
- **Languages beyond en/ar:** the field supports more languages through an "Add language" menu, and each added language field has the same button.

**Bulk edit**
- **The action:** "Translate titles of selected videos" (and descriptions) to a language. It reuses the rename preview pattern (`RenamePreview`) as a table of old value → suggested value.
  - Each row can be edited or unticked before applying.
  - Applying goes through the existing `PATCH /api/videos/bulk` with **undo** (24 h, `bulkEditUndo`).
- **Default:** rows where the target field already has creator text are skipped. "Overwrite" is an explicit tick.

**Quran-aware titles**
- If a title quotes an ayah, usually inside `{…}` («آية استوقفتني (12) {إنَّ الحَسَنَاتِ يُذْهِبْنَ السَّيِّئات}»), the suggestion uses the **official translation of that ayah**, wrapped in `{…}` with a reference chip in the editor: {Indeed, good deeds do away with misdeeds} (11:114).
- For a partial ayah, the official translation of the full ayah is offered with "partial quote" noted. The creator chooses.
- We measured 10 of 13 verse titles found uniquely, 2 correctly flagged as appearing in two places, and 1 missed (R§4).

**Viewer side (owner decision O6)**
- When a video has no title in the viewer's language, the viewer would see a cached machine translation, labelled with a small "Translated" marker and a "Show original" toggle.
- It is stored separately from creator text (§5.9) and never overwrites it. The creator can "Adopt" it into their own field, or turn auto-translation off for the channel.

## 4. Architecture

```
Studio (web/native) ──POST /api/videos/:id/captions/jobs──▶ api-videos
     ▲                     (auth, role, entitlement reserve, idempotency)
     │ websocket progress            │ enqueue
     │                               ▼
     │                      Queue al-ummah-now-captions[-qa]
     │                               │
     │                     processor (consumer, AI binding)
     │      ┌────────────────────────┼─────────────────────────────┐
     │      ▼                        ▼                             ▼
     │  Container "audio-extract"   SpeechToText provider     Translation provider
     │  (ffmpeg: HLS/R2 → 16 kHz    (Workers AI | ElevenLabs   (Workers AI LLM |
     │   mono chunks in R2)          | …), per chunk            DeepL | …)
     │                               ▼
     │                 post-process: hallucination filter → cue builder →
     │                 Quran detection (offline Tanzil index) → glossary
     │                               ▼
     └──────────── R2 subtitles bucket: draft JSON + VTT; D1 job/track rows; usage commit

Inline translate: Studio ──POST /api/translate──▶ api-videos (sync, ≤ 2 s budget)
                    → cache (KV) → Quran-in-title check → provider → audit + fair-use counter
```

- **api-videos** owns the API, entitlement checks, the job and track rows, and inline translation, which is synchronous.
- **processor** already has the `AI` binding, the `subtitles` R2 bucket and queue consumers, so it runs the jobs.
- **Containers** run only ffmpeg audio extraction. A fallback for videos with an original file in R2 (after the D2 R2 migration) reads the original directly.

## 5. Pipeline details

### 5.1 Request and idempotency
- `POST /api/videos/:id/captions/jobs` takes `{ sourceLanguage, targets: ["en"], providerHint?: "default"|"high_accuracy" }`.
- **Who may call it:** the owner, or a channel role with `video.edit`. The video must be `ready`. Private and unlisted videos are allowed (§9.1).
- **Idempotency key:** `sha256(videoId, kind, language, sourceVersion, provider)`. A duplicate request returns the existing job and never charges twice. The `Idempotency-Key` header is honoured for retries.
- **Reservation:** `ceil(durationSec/60) × languages` caption minutes, reserved atomically (§6.2).

### 5.2 Audio extraction
- **Container `audio-extract`** (instance type `basic`):
  1. Reads the lowest HLS rendition through a signed Bunny URL (`lib/bunny-signing.ts`), or the R2 original after the migration.
  2. Writes **16 kHz mono Opus/MP3 chunks of at most 10 minutes**, cut at the nearest silence (ffmpeg `silencedetect`) with 1 s overlap.
  3. Output goes to `captions-work/{jobId}/{n}.mp3` in R2, with a 7-day lifecycle rule.
- **Why 10 minutes:** it keeps each request under the Workers AI Batch API's 10 MB limit (48 kbps ≈ 0.36 MB/min).
- **Native Studio optimisation:** the native Studio can extract audio during upload with Core's media engine and upload it next to the video. That skips the container.
- **Cost:** a few seconds of vCPU per hour of video, about $0.00005/min, mostly covered by the Containers allowance (R§5).

### 5.3 Speech-to-text
- **Interface:** a `SpeechToTextProvider` adapter: `transcribe({ audioUrl | bytes, language, prompt, wordTimestamps }) → { segments[{start,end,text,words[]}], usage, costUsd } | { ok:false, code, retryable }`. It mirrors the CMS `WritingAssistProvider` (adapters never throw; same error codes).
- **Workers AI settings:**
  - `task:"transcribe"`, explicit `language`, **`vad_filter:false`**
  - `initial_prompt` = the video title plus up to 30 glossary terms
  - `condition_on_previous_text:false` (limits runaway repetition)
  - the default `compression_ratio_threshold`
- **Chunks** run in parallel, up to 4 per job and capped by a global concurrency limit. ASR allows 720 requests/min.
- **Retries:** exponential backoff, 3 attempts per chunk, then the fallback provider if the admin enabled one. Otherwise the job fails and the minutes are refunded.
- **Stitching:** word timestamps across the 1 s overlap are de-duplicated, and the chunk offset is added back.

### 5.4 Post-processing
1. **Hallucination filter.** Drop known phantom phrases when they don't fit the audio, such as «اشتركوا في القناة», "Thank you." and "Subtitles by…". Also drop n-grams repeated more than 3 times in a row, and segments whose speech probability is low. We measured exactly this failure (R§2.1).
2. **Cue builder:**
   - at most 42 characters per line and 2 lines, 1–7 s per cue, split at sentence or pause boundaries;
   - Arabic cues get RLM marks (as Core's `to_webvtt` already does).
3. **Quran detection** (§5.5).
4. **Glossary** normalisation, as suggestions only, never silent (§8).
5. **Honorifics:** Arabic transcripts keep the spoken form («صلى الله عليه وسلم»). A per-channel setting "Show ﷺ symbol in Arabic subtitles" is off by default.

### 5.5 Quran detection and replacement
- **Offline data:** Tanzil Uthmani 1.1 plus Simple-Clean, built at deploy time into a compact 3-gram index in R2 (about 2 MB) and loaded by the processor. A word-level Uthmani table handles partial quotes; source and licence are confirmed in O9. There are no runtime calls to third parties.
- **Normalisation:** strip diacritics and tatweel; unify alef forms (أ إ آ ٱ → ا), ى → ي, ة → ه; drop the hamza carriers ؤ ئ ء. That last rule fixes the 19:66 miss.
- **Matching** runs on the **whole transcript word stream**, not per cue, and the result is mapped back to cues through word timestamps. Per-cue matching missed a 3-cue ayah (R§3.2).
  1. Find 3-gram seeds.
  2. Extend each seed greedily with fuzzy word matching (Levenshtein ratio ≥ 0.7, at most 2 misses in a row).
  3. Map the span to a surah:ayah range plus word offsets.
  4. Merge spans within 2 ayat of each other in the same surah, filling the gap.
- **Thresholds**, from measurements and tunable in admin settings:

  | Level | Rule | Editor shows |
  |---|---|---|
  | `suggested` | ≥ 6 words and confidence ≥ 0.9, unique location | pre-highlighted, "Accept" |
  | `possible` | ≥ 5 words or confidence ≥ 0.8 | dotted highlight, never pre-accepted |
  | `ambiguous` | the matched words occur at more than one location | location picker |

- **Phrase-frequency penalty:** n-grams that occur in many places (e.g. «في سبيل الله», «قال رسول الله») can't open a span on their own. This removes the false positives we measured (R§4).
- **Replacement on accept:** the cue text for that word range becomes the official text.
  - Full ayat use the Uthmani text.
  - Partial ayat use the word-level Uthmani slice. A partial quote is shown as such, never as a "whole verse".
- **Recitation videos:** when Quran covers more than 70% of the transcript, the creator sees "This looks like a recitation of 55:1–25. Use the official text for all?" as one action.
- **Cost:** CPU only. A 1-hour transcript takes well under the Worker CPU limit.

### 5.6 Storage and data model

**R2 `subtitles` bucket** (keys extend today's layout):
- `{videoId}/{lang}.vtt` holds the **published** track. The player and the existing `GET /subtitles/:language` are unchanged.
- `{videoId}/drafts/{lang}/v{n}.json` holds the editable document.
- `{videoId}/drafts/{lang}/v{n}.vtt` is the preview.

**Draft document** (`CaptionDocument`, in shared-types):
```jsonc
{
  "videoId": "…", "language": "ar", "version": 3, "kind": "source" | "translation",
  "sourceVersion": 2,                      // translations: which source version they came from
  "machine": { "provider": "workers-ai", "model": "@cf/openai/whisper-large-v3-turbo", "promptVersion": "…" },
  "cues": [
    { "id": "c12", "start": 61.40, "end": 66.92, "text": "…",
      "segments": [
        { "type": "speech", "text": "الله عز وجل قال" },
        { "type": "quran", "surah": 3, "ayahStart": 166, "ayahEnd": 167, "wordStart": 0, "wordEnd": null,
          "textEdition": "tanzil-uthmani@1.1", "translationEdition": null,
          "confidence": 0.95, "status": "suggested" | "possible" | "ambiguous" | "accepted" | "rejected",
          "alternatives": [] }
      ] }
  ]
}
```
- In translations, a `quran` segment carries `translationEdition` (e.g. `quranenc:english_saheeh@1.1.2`) and the text verbatim from that edition.
- `SubtitleTrack` (existing type) gains `origin: "upload" | "machine" | "machine_edited"`, `status: "draft" | "published"`, `version` and `editions[]`. The existing `isAutoGenerated` becomes true for machine origins.

**D1 tables** (`SEARCH_DB` in api-videos, which already holds `admin_deletions`; new migration plus snapshot):
- `caption_jobs`:
  - identity: `id`, `idempotency_key UNIQUE`, `video_id`, `channel_id`, `requested_by`
  - work: `kind transcribe|translate`, `source_lang`, `target_lang`, `provider`, `model`
  - `status`: `queued|waiting_budget|extracting|transcribing|postprocessing|translating|ready|failed|cancelled`; also `step`, `progress`
  - money: `minutes_reserved`, `minutes_charged`, `cost_usd_est`
  - failure: `attempts`, `error_code`
  - timestamps: `created_at`, `updated_at`
- `caption_tracks`: `video_id`, `lang`, `kind`, `status`, `version`, `source_version`, `origin`, `published_at`, `published_by`.
- `glossary_terms`: `id`, `scope global|channel`, `channel_id`, `src_lang`, `tgt_lang`, `source`, `target`, `note`, `created_by`, `updated_at`.
- `quran_editions` (admin config): `lang`, `edition_key`, `version`, `title`, `attribution`, `licence_url`, `enabled`, `is_default`.

**KV `TRANSLATION_CACHE`:**
- **Key:** `sha256(normalisedSourceText, srcLang, tgtLang, glossaryVersion, promptVersion, model)` → `{ text, provider, model, at }`.
- **TTL:** 90 days.
- **Used by:** inline translation, viewer-side metadata and repeated cue batches.

### 5.7 Translation of transcripts
- **Input:** always the **corrected, published or latest draft source**, never raw ASR, and recorded as `sourceVersion`.
- **Masking:** Quran segments (accepted, or suggested and not rejected) are replaced by tokens `⟦Q1⟧`. The model is told to keep tokens verbatim.
- **Batches:** cues are sent as a JSON array, at most 6,000 characters per call (the CMS-proven chunk size), with the previous 3 cues as read-only context.
- **Output validation:** the array is the same length, every token is present exactly once, the output is in the target script, and the length ratio is between 0.4 and 2.5. On a failure: retry once, then use the fallback model, then fail the batch.
- **Token substitution:** the edition text for the target language, from QuranEnc offline data.
  - **Arabic target:** the Uthmani text itself.
  - **No edition for the language:** the cue shows the Arabic text plus the reference, and never MT.
  - **Long ayat:** if the ayah translation runs longer than the cue, the cue is extended or split across the speech span. The text is never trimmed (licence).
- **Prompts** are versioned (`PROMPT_VERSION`) and shared with inline translation (§8): Islamic-publication register, honorific rules (ﷺ ↔ «صلى الله عليه وسلم» display setting; (رضي الله عنه) ↔ "(may Allah be pleased with him)"), names in standard transliteration, glossary injected, digits kept as in the source.

### 5.8 Inline translation API
- **Endpoint:** `POST /api/translate`, synchronous.
  - Request: `{ texts: [{ id, text }], from?, to, context?: { videoId?, channelId?, field: "title"|"description"|"tag"|"playlist"|"post" } }`.
  - Response: `{ items: [{ id, text, quran?: [{ surah, ayahStart, ayahEnd, edition }], cached }], usage }`.
- **Limits:** at most 50 texts and 20,000 characters per call (bulk edit sends pages of 50).
- **Context:** the channel name plus the first 300 characters of the description are passed to the model as read-only context. This is what fixes rare names such as Shahrour/شحرور.
- **Quran in titles:** `{…}`-wrapped spans, and any span the detector finds with at least 3 words, go through Quran lookup. A unique hit gets the edition text; an ambiguous hit returns alternatives.
- **Latency budget:** 2 s p95. Measured p95 is 2.1 s for Gemma, and a cache hit takes about 10 ms. Past 2.5 s the client shows "Still translating…" and lets the creator cancel.
- **Fair use and audit:** fair-use counters (§6.4), and an audit row (actor, video, field, chars, provider, cost). Text is not stored in the audit.

### 5.9 Viewer-side metadata translation (if O6 = yes)
- **Store:** `metadata_translations(video_id, field, lang, text, source_hash, provider, model, created_at)` in D1. It is filled lazily on the first view in that language, or in a nightly batch for popular videos, and capped by the budget.
- **Read path:**
  - Search and cards read creator text first, then the machine translation if the channel allows it, then the original.
  - `titleLocalized` itself is **never** written by the system.
- **Invalidation:** a change to the source text (different `source_hash`) invalidates the translation.

### 5.10 Search (later phase)
- **FTS:** published transcripts, both creator-edited and machine, are indexed in `SEARCH_DB` FTS by video and cue time, so search can deep-link to `?t=`.
- **Semantic search:** an optional Vectorize step can come later. Quran references become filters ("videos quoting 3:139").
- **Private videos** are excluded from public search.

## 6. Entitlements, metering and add-ons (Epic 27)

### 6.1 Keys (catalogue `packages/shared-types/src/entitlements.ts`)

| Key | Type | Meaning | Suggested seed: Free / Plus / Pro / Institution |
|---|---|---|---|
| `captions.monthlyMinutes` | number | caption minutes per month (1 per video-minute per language produced) | 60 / 600 / 3,000 / 15,000 |
| `captions.maxTargetLanguages` | number | translation targets per job | 1 / 3 / 10 / unlimited |
| `captions.highAccuracy` | boolean | may choose the fallback (third-party) provider | false / false / true / true |
| `captions.editor` | boolean | transcript editor (always true; kept as a key for parity) | true |
| `translate.inline.dailyItems` | number | inline translations per user per day (fair use) | 200 / 1,000 / 5,000 / 20,000 |
| `translate.bulk.maxItems` | number | items per bulk translate | 50 / 200 / 1,000 / 5,000 |
| `translate.viewerAuto` | boolean | channel's titles may be auto-translated for viewers (if O6) | true |

These are seeds for admins to edit; plans stay admin-managed.

### 6.2 Metering
- **Counter:** `usage_counters` row `(channel, id, "captions.minutes", "YYYY-MM")`.
- **Reservation:** a conditional upsert `UPDATE … SET value = value + :n WHERE value + :n <= :limit` in the same D1 batch as the job insert.
  - **Commit:** the reservation stands when the job finishes. The actual minutes ≤ reserved, and the difference is released.
  - **Refund:** on failure or cancel, the whole reservation is released. Refunds are audited with the job id.
- **Re-runs:**
  - Retranslating after an edit charges again.
  - Re-running after a platform-side failure is free (`waived_reason`).
  - Editing a transcript is always free.
- **Warning:** at 80%, through `warning:true` in API responses and a Studio banner.

### 6.3 Add-ons and admin grants
- **What's missing today:** Epic 27 overrides *replace* a key's value. Add-on packs need **additive grants**. This proposal adds a table `entitlement_grants(id, subject_type, subject_id, key, amount, period_scope "month"|"until_used", expires_at, source "admin"|"purchase"|"promo", reference, reason, created_by, created_at, revoked_at)`.
  - Effective limit = resolved plan value + the sum of active grants.
  - Unused "until_used" pack minutes are consumed after the plan minutes.
- **Admin-web:** Plans → Grants. The admin grants or revokes minutes per **user or channel** with a search picker, never a raw id (admin-pickers rule). A reason is required, and `plan_audit_log` is written in the same batch.
- **Payment:** add-on purchases go through the pluggable payment providers when they exist (never Stripe; Epic 27 payments are deferred). Until then the admin grants manually: `source:"admin"`, with a reference to an invoice or receipt.
- **Suggested pack prices** (admin-editable), covering the fallback provider and payment fees:

  | Pack | Price | Our cost on the default stack | Our cost on the fallback (Scribe) |
  |---|---|---|---|
  | 1,000 caption minutes | **$3** | ≈ $0.48 | ≈ $3.40 if all were transcription |
  | 5,000 | $12 | ≈ $2.40 | ≈ $17 |
  | 20,000 | $40 | ≈ $9.60 | ≈ $68 |

  **High-accuracy jobs use 3× minutes**, because the Scribe-based cost is ≈ 7× the default.

### 6.4 Inline title translation: free with fair use (recommended)
- **What it costs us:**
  - a title is about 73 characters and costs about $0.00002 (Gemma) to $0.00007 (DeepSeek);
  - 100,000 title translations a month ≈ $2–7;
  - a description of about 600 characters costs about $0.0003;
  - bulk-translating 1,000 videos (title plus description) ≈ $0.37.
- **Why not meter it:** metering it in caption minutes would cost more in user friction than it saves. So it's free on every tier, with `translate.inline.dailyItems` as abuse protection, cache hits not counted, and the global budget (§7.3) as the backstop.
- **DeepL** (if enabled) costs about €0.0016 per title, roughly 70 times more. It stays opt-in per environment and doesn't change entitlements.

## 7. Cost model

### 7.1 Per video-minute (list prices, 2026-11-11, plus our measurements)

| Item | Default stack | Notes |
|---|---|---|
| Speech-to-text | $0.00051 | Workers AI turbo, 46.6 Neurons/min measured |
| Audio extraction | ≈ $0.00005 | Containers, mostly inside the monthly allowance |
| Queue, R2, D1, KV | < $0.00001 | |
| Quran detection, glossary | ≈ 0 | Worker CPU |
| **Transcription total** | **≈ $0.00056/min ($0.034/h)** | |
| Translation, per target language | **$0.00040/min ($0.024/h)** with DeepSeek; $0.00012 with Gemma | measured, 609 characters per minute of speech |
| Inline title | $0.00002–0.00007 per title | measured |

### 7.2 Monthly scenarios (transcription plus 1 translation language per job)

| Stack | 100 h/month | 1,000 h | 10,000 h |
|---|---|---|---|
| **Default (Workers AI ASR + DeepSeek)** | **$6** | **$58** | **$578** |
| Workers AI ASR only | $3 | $34 | $338 |
| ElevenLabs Scribe + Workers AI translation | $22 | $224 | $2,240 |
| Google dynamic batch / gpt-4o-mini-transcribe + Workers AI translation | $20 | $204 | $2,040 |
| Speechmatics Melia + Workers AI translation | $26 | $264 | $2,640 |
| Workers AI ASR + DeepL (1 language) | ≈ €84 | ≈ €838 | ≈ €8,377 |
| Bunny transcribe + translate | $1,200 | $12,000 | $120,000 |

### 7.3 Where the $500 cap bites, and how it stays sustainable
- **Default stack:** 10,000 h/month (~$578) alone breaks the cap. The platform also pays for delivery, workers and other AI.
- **Proposed captions budget:** `monthlyBudgetUsd` defaults to **$100** (max $500), the same pattern as the CMS. That buys ≈ **1,700 h/month** on the default stack, or ≈ 450 h on Scribe.
  - **Daily slices:** spending is recorded in the existing `ai_budget_daily` with feature `captions`, plus `inline-translate` with its own $20 default. A daily slice (monthly ÷ days remaining × 1.5) stops one day's spike from using the whole month.
  - **When reached:** new jobs go to `waiting_budget` with the en/ar message "Busy right now; your subtitles will start within 24 h". Reserved minutes aren't charged while waiting. An admin alert goes through the cost-monitoring hooks (AUN-COST).
- **What bounds exposure:** the sum of all plan allowances. If 2,000 free channels each used all 60 minutes, that's 120,000 caption minutes ≈ $58 a month.
- **Add-ons:** paid packs priced at ≥ 6× the default-stack cost make extra volume self-funding.
- **Revisit:** when monthly usage passes 5,000 h, revisit the self-hosted GPU option from the 2025 research doc.

## 8. Glossary and terminology

- **Two levels:** a global admin glossary (Islamic terms, honorifics, names of the Prophets, companions, scholars and books) plus a per-channel glossary edited in Studio → Settings → Glossary, with search and autocomplete.
- **Seed:** about 300 en↔ar pairs, for example:
  - salah/صلاة, zakat al-fitr/زكاة الفطر, tafsir/تفسير, halaqa/حلقة;
  - Musa/موسى (not Moses, by default);
  - Ibn Abbas/ابن عباس, al-Nawawi/النووي;
  - Muhammad Shahrour/محمد شحرور.
- **Honorific rules** are part of the prompt, not the glossary.
- **Uses:**
  1. Whisper `initial_prompt` (the top terms by channel frequency).
  2. Suggestions in the editor.
  3. Injected into translation prompts as "Use these renderings".
  4. A DeepL glossary sync (v3 multilingual glossaries) if DeepL is enabled.
- **Versioning:** `glossaryVersion` is part of the translation cache key, so editing the glossary invalidates cached translations.

## 9. Privacy, moderation, retention, licences

### 9.1 Private videos and providers
- **Allowed providers:** Workers AI by default; Cloudflare doesn't train on customer data. A third-party provider is used only if the admin enabled it **and** marked it `retention: none` (e.g. DeepL Growth deletes texts after translation).
- **Private and unlisted videos** never go to a provider marked `retention: provider-default`. ElevenLabs keeps data unless the account is on enterprise zero-retention (R§5). For such videos the "High accuracy" choice is disabled, with an explanation.
- **Audio** goes to providers as short-lived signed R2 URLs (`source_url`), valid for 1 h, or as bytes. It is never a public URL.

### 9.2 Deletion
- **Soft delete** keeps transcripts and drafts, so they are restorable within 30 days. Purge (the `video.purge` admin job) must delete:
  - `subtitles/{videoId}/**` (published and drafts);
  - `caption_jobs` and `caption_tracks` rows;
  - `metadata_translations` rows;
  - FTS rows;
  - `captions-work/{jobId}/**`.
- **Gap found:** today's purge has no step for the subtitles bucket. It is fixed in [#814](https://github.com/Al-Ummah-Now/AlUmmahNow/issues/814) and covered by this spec's tests.
- **Third-party copies:** jobs at a third-party provider are deleted through its API after success, where the API allows it.

### 9.3 Moderation
- **Feeding Epic 28:** published transcripts feed the planned audio-transcript text check in Epic 28 (AI-MODERATION §2), which then needs no ASR of its own.
- **Reports:** a report on a video can cite a cue (time link).
- **Quran content** is excluded from violence and hate classifiers (AI-MODERATION principle 3). Detected Quran segments are tagged so the classifier skips them.

### 9.4 Licence obligations (shown in the UI and docs)
- **Tanzil:** text verbatim and unchanged; "Quran text: Tanzil Project (tanzil.net), CC BY 3.0, v1.1" shown with a link wherever Quran text appears (watch-page subtitle info, editor footer). Update notices from tanzil.net/updates are watched.
- **QuranEnc:** no changes to the text. Credit, for example "Translation of the meanings: Noor International Center (Saheeh International), QuranEnc.com, v1.1.2". Keep the version up to date, using a monthly job that compares `/translations/list` versions and flags updates for the admin. Never place inappropriate ads next to it. Whether footnote markers "[n]" may be dropped is open (O9); until then they are kept, with the footnotes available on hover.
- **Quran Foundation API** (if used for timestamps or search): cache at most 1 week, credit Quran Foundation, no model training.
- **Not used** (licence not cleared): The Clear Quran, Tanzil translations, and alquran.cloud.

## 10. Provider routing (admin-configurable)

- **Admin screen:** admin-web → AI → Captions & Translation, one row per environment. It mirrors the CMS `ai_settings` behaviour: version check, audit to `ai_settings_audit`, and keys referenced by Secrets Store name `AI_KEY_*`, never stored.
- **Per feature:**
  - **features:** `asr`, `transcript_translate`, `inline_translate`, `quran_lookup`
  - **routing:** primary `{provider, model}`, fallback, and per-language overrides (e.g. `asr.ar → elevenlabs` once measured, `inline_translate.fr → deepl`)
  - **limits:** enabled flag, per-provider monthly cap in USD
  - **privacy:** retention class
  - **tuning:** thresholds (Quran confidence) and the prompt version
- **Shared adapter layer:** extract the CMS `src/lib/ai` into a package (`@al-ummah-now/ai-providers`) consumed by both repos, adding `SpeechToTextProvider` and `TranslationProvider` next to `WritingAssistProvider`. Until it is extracted, the monorepo mirrors the interfaces (O8).
- **Adapters:**

  | Phase | Adapters |
  |---|---|
  | P1 | Workers AI (Whisper, LLMs) |
  | P3 | ElevenLabs Scribe, DeepL |
  | Later | generic HTTP (config-only, as in the CMS) |

## 11. Native Studio and on-device transcription

- **What Core can already do:** whisper.cpp in Core 0.2.0 (`aun-media` `transcribe`), with the large-v3-turbo q5_0 model at 574 MB.
  - Measured on an M3 Ultra: 40× real time on GPU and 3× on CPU (4 threads).
  - Raw quality was **worse than Workers AI** on Quran (33% vs 6% WER). After the Quran layer, 7.6% vs 4.9%. English was the same.
- **Proposal:** "Transcribe on this device (free, doesn't use minutes)" in the native **desktop** Studio. Apple Silicon and machines with a GPU first; phones later after measuring them.
  - The output is uploaded as a draft `CaptionDocument` with `origin:"machine"` and `provider:"on-device"`.
  - It then goes through the **same** server-side Quran detection, editor, translation and publish steps.
  - This resolves wiki decision D10 as a hybrid, now with numbers.
- **Native parity:** the native Studio gets the Subtitles tab (status, Transcribe/Translate, publish) in its Studio MVP parity work. The full editor ships on the web first; native has a simplified cue editor.

## 12. Rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0: foundations** | provider interfaces plus Workers AI adapters; Quran data build (Tanzil plus QuranEnc en/ar), index and detector with unit tests on the R§4 cases; glossary tables plus seed; `TRANSLATION_CACHE`; `entitlement_grants`; catalogue keys | detector reproduces R§4 (5 TP, 0 FP at `suggested`); licences credited |
| **P1: inline title translation** | `POST /api/translate`; Translate buttons on title/description in the upload form, Studio editor and "Set values"; Quran-aware titles; fair-use counters | p95 ≤ 2 s on QA; 67-title set ≥ 90% acceptable; en/ar UI |
| **P2: on-demand transcription** | jobs API, queue, Container extraction, ASR, post-processing, Quran detection, drafts, editor v1, publish, metering with reserve/commit/refund, usage meter, 402 hard stop, budget stop, purge coverage | QA run on the 8 R§1 clips meets R§2 numbers; refund on forced failure; idempotent double-click |
| **P3: translation of transcripts** | cue-batch translation with Quran tokens and QuranEnc editions; retranslate on source change; bulk Transcribe/Translate; upload flag; admin grants UI | Quran cues carry the edition text verbatim; attribution visible |
| **P4: providers and viewers** | ElevenLabs and DeepL adapters (after O1/O2 measurement), per-language routing; viewer-side metadata translation (if O6); descriptions, tags, playlists, posts | measured Scribe ≥ default on R§1 set before enabling |
| **P5: search and native** | transcript FTS and deep links; native Studio Subtitles tab; on-device desktop transcription | |

Every phase ships behind an environment flag. Tests go into the release E2E suite: inline translate en/ar; transcribe a seeded 40 s clip on QA; editor accept Quran; publish; player shows the track.

## 13. Follow-ups found during research

1. **The processor's moderation translates with `@cf/meta/m2m100-1.2b`**, which R§3.1 and CMS §1.5 show is unusable for Arabic. It should move to the shared translation provider: [#813](https://github.com/Al-Ummah-Now/AlUmmahNow/issues/813).
2. **The purge job doesn't delete the subtitles bucket objects** for a video (§9.2): [#814](https://github.com/Al-Ummah-Now/AlUmmahNow/issues/814).
3. **`docs/research/transcription-and-search-architecture.md` (2025)** compares RunPod and Bunny at old prices. Mark it superseded by R§5.

## 14. Open decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| O1 | ElevenLabs key: which plan do we have, and may we measure Scribe on the R§1 clips (≈ 20 minutes of audio, a few cents)? | Yes; it becomes the high-accuracy fallback only if it beats the default |
| O2 | DeepL: do we have an account (Growth costs €29.75/month)? | Not needed for launch; add as an optional adapter if wanted for languages beyond en/ar |
| O3 | Caption-minute allowances per tier (§6.1 seeds) and pack prices (§6.3) | Accept the seeds; admins can edit them |
| O4 | Captions monthly budget | $100/month (≈ 1,700 h on the default stack), inline translation $20 |
| O5 | Inline title translation free with fair use, or metered | Free with fair use (§6.4) |
| O6 | Viewer-side machine-translated titles (labelled, cached, never overwriting) | Yes, after P3, opt-out per channel |
| O7 | Default Quran translation editions per language | en: QuranEnc `english_saheeh` (Noor International), alternative `english_rwwad`; other languages from QuranEnc's list; ar: the Uthmani text |
| O8 | Extract the CMS provider layer into a shared package now, or mirror it | Mirror in P0–P2, extract once both use it |
| O9 | Licence follow-ups: ask QuranEnc whether footnote markers may be hidden, and confirm the source and licence of the word-level Uthmani data for partial quotes (QUL vs QF) | Email both before P3 |
| O10 | "ﷺ" symbol in Arabic subtitles: off by default (keep the spoken words), per-channel setting | As recommended |
| O11 | On-device transcription in native desktop Studio as a free path (D10 hybrid) | Yes, in P5 |
