# Transcription, translation and inline metadata translation (Quran-aware)

**Status:** Draft v1 for review
**Date:** 2026-11-11 (v2 the same day: zero-mistake Quran design, QF Content Sync as the Quran source, measured DeepL, full price comparison)
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
| Speech-to-text, high accuracy | **DeepL Voice** (on the owner's DeepL API Pro account, $1.85/h), admin-enabled for higher tiers and as the Quran second opinion. **ElevenLabs Scribe v3** ($0.20/h) stays a candidate once measured | Measured: best Arabic (Al-Mulk 2.1% WER vs 6.2% for Workers AI), and al-Fajr mujawwad 16/16 ayat vs 13/16. But it is real-time streaming only (≤ 2× real time) and 54× the default's cost (R§9). Scribe is still unmeasured (O1). |
| Not used | Bunny built-in transcription ($0.10 per language-minute, Whisper-based, no glossary); Cloudflare Stream captions (no Arabic); Workers AI nova-3 (no Arabic); Media Transformations audio extraction ($0.03/min, 10-minute limit) | R§2, R§5 |
| Transcript translation | **DeepSeek V4.1 Flash** on Workers AI, falling back to Gemma 4 26B | Cue-accurate and honorific-correct at $0.0004 per video-minute. It is already the CMS default (R§3.2). |
| Inline title/description translation | **Gemma 4 26B** on Workers AI, falling back to DeepSeek V4.1 Flash. DeepL is an optional adapter. | p50 1.0 s, p95 2.1 s, $0.00002 per title, quality equal to DeepSeek (R§3.1) |
| Premium translation path | **DeepL API Pro** with a glossary, opt-in on higher tiers (transcripts and titles) | Measured: fastest (titles p50 0.56 s), and its glossary fixed names and terms. It also made meaning slips the default didn't: «فصامه موسى شكرا» → "so thank you"; "He is the One" → «هو المخلص»; «نشيد» → «أغاني» without the glossary. Quran stays masked either way (R§9). |
| Dubbing (later) | DeepL speech-to-speech is technically viable (a 52 s clip became a 59 s English voice track) | It spoke a machine translation of the ayat. Quran spans must keep the original audio and are never synthesised (principle 3). |
| Never | m2m100 (unusable: invented hadith, repetition loops), gpt-oss (answers instead of translating) | R§3.1, CMS §1.5 |
| Quran display | **Official text only, never ASR**: a span shows the stored official text for an exact word range after creator confirmation, or a reference with no text | Measured 0 wrong ayat and 0 extra words on 20 clips (R§8) |
| Quran text | **Quran Foundation Content Sync** (`quran_core:1`, `mushafs:4`), a local copy synced at least every 7 days. Tanzil XML is the fallback | The QF terms allow offline copies kept through Content Sync (quoted in §9.4). Needs Developer Console registration (O12) |
| Quran translations | **QF Content Sync `translations:<id>`** for editions QF publishes as syncable; **QuranEnc** offline files for anything QF doesn't offer. English default: Saheeh International | Which translation ids are public for sync is only visible with credentials (O12). QuranEnc terms allow republishing with attribution and version (§9.4). |
| Metering | One "caption minute" per video-minute per language produced; plan allowance plus add-on packs plus admin grants | §6 |
| Inline title translation | **Free on every tier, with a fair-use cap** | 100,000 title translations cost about $2 (§6.4) |
| Cost at scale | 1,000 h/month of jobs ≈ **$59** with the default stack; 10,000 h ≈ $590, which breaks the cap, so it is bounded by tier minutes and a budget stop | §7 |

## 2. Principles

1. **On demand, never automatic.** Nothing is transcribed or translated unless a creator (or an admin acting for them) asks. The "transcribe after processing" upload flag counts as asking.
2. **Never silent.** Machine output is a **draft** until the creator publishes it. Inline translations are **suggestions** in the form. Machine text shown to viewers is labelled.
3. **Quran is never machine-written.** ASR text is never shown for Quran, and Quran is never machine-translated or machine-spoken (no text-to-speech or dubbing of ayat). Only the official text from the synced store is rendered, after creator confirmation. Translations are recognised editions with attribution.
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
  - **Accept:** the span renders the official Uthmani text from the store. It can't be edited, only rejected or re-referenced.
  - **Reject:** "Not Quran" (the ASR text stays as ordinary speech) or "Different reference" (a picker).
  - Unconfirmed spans are never shown as Arabic text, only as a reference suggestion (§5.5).
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
     │                 Quran detection (offline QF-synced index) → glossary
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

### 5.5 Quran: zero wrong text by construction

The owner's rule (2026-11-11): **zero mistakes in any Quran text we show.** Fuzzy replacement still left 2.8–4.9% WER (R§2.1), so the design changed.

**Display rule.** ASR output is never displayed for Quran. A Quran span is either:
- rendered from the official text for an exact `(surah, ayah, word)` range, or
- shown as a reference only: "Quran 55:13 (unconfirmed)" with no Arabic text.

ASR can then never put a wrong *letter* on screen. What remains is the risk of choosing the wrong *passage*, measured below.

| Risk | What could go wrong | Control | Measured on 20 clips (R§8) |
|---|---|---|---|
| (a) Identification | the wrong surah:ayah is shown | auto-suggest only when the span is ≥ 6 words at ≥ 0.9 agreement (or ≥ 20 words at ≥ 0.75) **and** the words occur at exactly one place in the Quran. Repeated phrases use verse-order context from neighbouring confirmed spans, or go to review | **0 wrong ayat shown**; 96 of 110 recited ayat (87%) auto-suggested; all false candidates (7 in lectures) went to review, none shown |
| (b) Boundaries | words shown that weren't said, or recited words left out | the word range is exactly the matched range; left-extension recovers garbled first words; a spoken-letters table handles muqatta'at («يا سين» → يس); the basmala is a separate segment, never glued to an ayah | **0 extra words shown**; 91.3% of recited words shown; the omissions (mostly mujawwad) are flagged for review |
| (c) Timing | the right text in the wrong place | cue times from ASR word timestamps, snapped to the nearest recitation pause (adaptive `silencedetect`) | ayah starts: median error 33 ms, p90 278 ms, 88% within 300 ms (Whisper alone: median 445 ms) |

**Pipeline**
1. **Offline Quran store**
   - Built from the **QF Content Sync** copy (§9.4): `quran_core:1` for verse and word text, `mushafs:4` for word-level Uthmani text.
   - The detection index (normalised word stream plus a 3-gram index, about 2 MB) is rebuilt after every sync.
   - Tanzil XML is the fallback source. Use the **XML**, not the TXT export: the TXT download glues the basmala onto ayah 1 of every surah (`18|1|بسم الله الرحمن الرحيم الحمد لله…`), which would itself be wrong text. The XML keeps it in a `bismillah` attribute.
2. **Normalisation:** strip diacritics and tatweel; unify alef forms; ى → ي, ة → ه; drop ؤ ئ ء.
3. **Spoken letters:** ASR word sequences for the muqatta'at are mapped to the letters as written (يا سين → يس, الف لام ميم → الم, حا ميم → حم, …).
4. **Candidates:** run over the whole transcript word stream, then map back to cues by word timestamps:
   - 3-gram seeds;
   - greedy fuzzy extension to the right (Levenshtein ≥ 0.7, at most 2 misses in a row);
   - extension to the left over garbled first words.
5. **Uniqueness:** count every place the matched official word sequence occurs (`occ`).
   - `occ > 1` → ambiguous, e.g. «فبأي آلاء ربكما تكذبان» occurs 31 times.
   - Then **verse-order context** decides: if exactly one candidate lies within 2 ayat after the previous confirmed span (or before the next one) in the same surah, it is taken as `context`; otherwise the span goes to review.
6. **Classes**

   | Class | Rule | Shown to viewers before the creator acts? | Editor |
   |---|---|---|---|
   | `confirmed` | unique, (≥ 6 words and agreement ≥ 0.9) or (≥ 20 words and ≥ 0.75) | **No.** Every Quran span needs creator acceptance before publish (owner rule: mandatory confirmation) | pre-selected "Accept" with the reference chip and audio scrub |
   | `context` | an ambiguous span resolved by verse order | No | pre-selected, labelled "resolved by order" |
   | `basmala` | the basmala just before ayah 1 of a confirmed surah | No | shown as basmala, not as an ayah |
   | `review` | possible (4–5 words or lower agreement), ambiguous, or gaps inside a recitation | No | reference suggestion **without text**: "Possible Quran 2:143?" with Accept, Change reference, or Not Quran |
   | dropped | under 4 words | – | the creator can still "Mark as Quran" by hand |

7. **Accepting** stores `(surah, ayahStart, wordStart) → (surah, ayahEnd, wordEnd)` plus the edition id and sync version. The text is **rendered at publish time from the store**, never copied from ASR, and it can't be edited by hand.
   - **Rejecting** offers two choices:
     - "Not Quran": the ASR text stays as ordinary speech.
     - "Different reference": a picker; the text again comes from the store.
   - **Unreviewed Quran spans:** a track can't be published while it has any. "Publish without Quran text" is the escape hatch: those spans then show the reference only.
8. **Second opinion (optional, high-accuracy tier).** For recitation videos where coverage is under 100%, the Quran spans alone are re-run through a second ASR (DeepL Voice measured best on mujawwad: al-Fajr went from 13/16 to 16/16 ayat).
   - Spans where both agree are auto-suggested.
   - Spans where they disagree go to review.
   - Cost is only the Quran minutes (≈ $1.85/h on DeepL).
9. **Timing:** the cue start is the matched first word's timestamp, snapped to the nearest pause end within ±2 s. The pause threshold adapts per clip (−40 to −20 dB, the loosest that finds ≥ n−1 pauses).
   - **Better timing, later (P5):** forced alignment with an Apache-2.0 Quran aligner (Quran-Lab `mfa-quran-hafs`, published phone-boundary error 10–20 ms) on Quran spans only, in the audio container.
   - **Reciters in QF's audio:** use QF `chapter_recitations` word segments directly.
10. **Recitation videos:** when Quran covers more than 70% of the transcript, the editor offers "Recitation of 89:1–16 — accept all confirmed ayat". Gaps stay as review items. The text is never invented for them.

**Not chosen, with reasons (R§10)**
- **Tarteel:** "we currently do not offer a public API".
- **Quran-tuned Whisper/wav2vec2 models** (the best published is about 3–8% WER on recitation): they would still need the same display rule, and need a GPU.
- **Audio fingerprinting:** only identifies copies of known recordings, not a lecturer reciting.
- **Commercial Quran captioners** (e.g. AyahFlow): consumer tools with no API.
- **MMS / ctc-forced-aligner default models:** licensed CC-BY-NC.
- **whisper-timestamped:** AGPL.

**Cost:** Worker CPU for matching, plus one `silencedetect` pass in the audio container already running for extraction: about $0.001 per hour of audio. The second opinion is optional and only covers Quran minutes.

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
          "textEdition": "qf:quran_core:1@<syncSeq>", "translationEdition": null,
          "confidence": 0.95, "status": "confirmed" | "context" | "basmala" | "review" | "accepted" | "rejected",
          "alternatives": [] }
      ] }
  ]
}
```
- In translations, a `quran` segment carries `translationEdition` (e.g. `qf:translations:<id>@<syncSeq>` or `quranenc:english_saheeh@1.1.2`) and the text verbatim from that edition.
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
- **Token substitution:** the edition text for the target language, from the QF-synced store (QuranEnc offline data as fallback).
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
- **Why not meter it:** metering it in caption minutes would cost more in user friction than it saves. So it's free on every tier, with `translate.inline.dailyItems` as abuse protection, cache hits not counted, and the global budget (§7.4) as the backstop.
- **DeepL** (API Pro) costs about $0.002 per title, about 100 times more. It was fast in our test (p50 0.56 s), and its glossary fixed the names it got wrong. Titles still had meaning slips (R§9). It is offered as an opt-in "DeepL with glossary" path on higher tiers, counted against `translate.inline.dailyItems` at 20×.

## 7. Cost model

Prices: provider pages fetched 2026-11-11 (R§5), the owner's DeepL plan terms (2026-11-11), and our own measurements. One hour of speech ≈ **36,500 characters** of transcript (measured: 609 characters per minute).

### 7.1 Unit prices

**Transcription**

| Provider | Per hour of audio | Notes |
|---|---|---|
| **Workers AI Whisper turbo** (default) | **$0.031**, + ≈ $0.003 extraction = **$0.034** | measured 46.6 Neurons/min |
| ElevenLabs Scribe v3 | $0.20 (+ $0.05 keyterms) | not measured |
| DeepL Voice STT (API Pro) | **$1.85** | measured; real-time streaming only, ≤ 2× real time |
| Google STT dynamic batch / OpenAI gpt-4o-mini-transcribe / Azure batch | $0.18 | benchmarks |
| Speechmatics Melia | $0.24 | benchmark |
| Bunny transcribe | $6.00 **per language** | measured, not used |

**Translation**

| Provider | Per 1K characters | Per hour of speech, per language | Notes |
|---|---|---|---|
| **Workers AI DeepSeek V4.1 Flash** (default, transcripts) | $0.00066 | **$0.024** | measured |
| **Workers AI Gemma 4 26B** (default, titles) | $0.0002 | $0.007 | measured |
| **DeepL API Pro** | **$0.0275** | **$1.00** | measured; $5.49/month base |
| Google NMT / Azure Translator / AWS Translate | $0.020 / $0.010 / $0.015 | $0.73 / $0.37 / $0.55 | benchmarks |

**Quran pipeline (§5.5):** ≈ $0.001 per hour of audio. That covers Worker CPU for matching and a pause scan in the existing container. QF Content Sync has no price on its docs page; the sync job runs at least weekly. The optional second opinion with DeepL Voice costs $1.85 per hour of *Quran* audio only.

**Inline titles** (about 73 characters each):

| Provider | Per title | Per 100,000 titles |
|---|---|---|
| Gemma | $0.00002 | $2 |
| DeepSeek | $0.00007 | $7 |
| DeepL Pro | $0.0020 | $200 |

### 7.2 Monthly totals (transcription plus 1 translation language per job, including the Quran pipeline)

| Stack | Per hour | 100 h/month | 1,000 h | 10,000 h |
|---|---|---|---|---|
| **A. Default: Workers AI ASR + Workers AI DeepSeek** | $0.059 | **$6** | **$59** | **$590** |
| B. Workers AI ASR + **DeepL Pro** translation | $1.04 | $109 | $1,044 | $10,393 |
| C. **DeepL Voice STT + DeepL translation** (Pro) | $2.85 | $291 | $2,859 | $28,543 |
| D. Same as C on DeepL **Growth** ($32.50/month incl. 1M chars + 10 STT h) | – | $272 | $2,840 | **not possible**: caps of 300 voice h and 50M chars/month |
| E. ElevenLabs Scribe + Workers AI translation | $0.228 | $23 | $228 | $2,280 |
| F. ElevenLabs Scribe + DeepL Pro translation | $1.21 | $126 | $1,214 | $12,085 |
| G. Default + DeepL Voice second opinion on Quran minutes (assume 10% of audio is Quran) | $0.244 | $24 | $244 | $2,440 |
| H. Bunny transcribe + translate | $12.00 | $1,200 | $12,000 | $120,000 |

### 7.3 DeepL: API Pro (current) vs Growth
- **API Pro:** $5.49/month plus $27.50 per 1M characters and $1.85 per STT hour. **No volume cap**, so DeepL STT is not capped at 300 h on Pro. It is just 54× the Workers AI price.
- **Growth:** $32.50/month **including** 1M characters, 10 STT hours and 5 speech-to-speech hours, with caps of 50M characters and 300 voice hours a month. Above the allowance it costs the same per unit as Pro.
- **When Growth pays off:** it costs $27.01 more in base fee. It pays off once a month uses more than that much of the allowance at Pro prices: about **0.98M characters**, or for example 0.5M characters plus 7.2 STT hours. The most it saves is about $19/month (1M characters + 10 STT h = $46 of usage), plus the STS hours.
- **At our scale** DeepL is a premium path in either plan. Growth's caps rule it out as a bulk default.

### 7.4 Where the $500 cap bites, and how it stays sustainable
- **Default stack:** 10,000 h/month (~$590) alone breaks the cap. The platform also pays for delivery, workers and other AI.
- **Proposed captions budget:** `monthlyBudgetUsd` defaults to **$100** (max $500), the same pattern as the CMS. That buys ≈ **1,700 h/month** on the default stack, ≈ 450 h on Scribe, or ≈ 96 h on DeepL Pro translation.
  - **Daily slices:** spending is recorded in the existing `ai_budget_daily` with feature `captions`, plus `inline-translate` with its own $20 default. A daily slice (monthly ÷ days remaining × 1.5) stops one day's spike from using the whole month.
  - **When reached:** new jobs go to `waiting_budget` with the en/ar message "Busy right now; your subtitles will start within 24 h". Reserved minutes aren't charged while waiting. An admin alert goes through the cost-monitoring hooks (AUN-COST).
- **DeepL jobs** (high-accuracy STT, DeepL translation) use their own per-provider monthly cap (§10). On a tier that includes them, they use **caption minutes at 30×** (DeepL Voice STT) and **20×** (DeepL translation), matching their cost ratio to the default.
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

### 9.4 Quran sources, licences and obligations

Every statement below quotes its source. Both pages were fetched on 2026-11-11.

**Quran Foundation (QF) Content Sync: primary source.**

Source: [Developer Terms](https://api-docs.quran.foundation/legal/developer-terms/) ("Last updated: 2026-10-11"), §3.1.
- **Storage beyond a week:** "Cache or store QF Content longer than 1 week unless it is obtained and maintained through the Content Sync APIs listed under Content Available for Offline Sync, or consists of font files or Mushaf images cached or bundled as described below."
- **The only path to an offline copy:** "If a content resource is available through Content Sync, Content Sync is the only permitted path for obtaining and maintaining an offline copy of that resource; do not build an offline copy from regular API responses."
- **Weekly refresh:** "When using Content Sync, you must perform a next sync at least every 7 days when connectivity to QF permits and apply all available changes. This ongoing obligation applies to copies kept on a backend or an offline device."
- **Fonts and Mushaf images:** "A Developer may cache or bundle font files and Mushaf images obtained through QF APIs or documented CDN URLs for use in an Application if the Developer maintains an active account in the Developer Console and credits Quran Foundation in a reasonably accessible place in the Application or its associated credits."
- **No prepackaged bundles:** "The Content Sync storage exception does not itself authorize distributing a prepackaged database or build-time bundle of QF Content." So the store is filled by the sync job at runtime, never committed to the repo or bundled into a build.
- **Unmodified text:** "The text of the Quran is not modified in any way." The matching index is normalised internally, but what is displayed is the synced text, verbatim.
- **Indexes count as derived content:** the definitions say "Derived Materials: Outputs made from or using QF Content, including excerpts, compilations, indexes, embeddings, … An output that reproduces or permits reconstruction of QF Content remains subject to the restrictions on that content." So the detection index is rebuilt from, and lives only as long as, the synced copy.
- **Videos shared outside the platform:** "Incorporating QF Content into a social-media video is an end-user use, not redistribution, provided that the Developer credits Quran Foundation in a reasonably accessible place, such as in the video itself or its caption, description, or credits."
- **Serving from our backend:** "Serving QF Content from a Developer-controlled backend within the Application's end-user experience is not, by itself, redistribution. Offering QF Content or raw API data to others as data remains subject to the separate commercial-license requirement above."
- **No model training:** "Use QF Content or User Data to build … machine-learning models without written consent" is prohibited. We don't train on it.

Source: [Getting Started with Content Sync](https://api-docs.quran.foundation/docs/tutorials/content-sync/getting-started/), "Content Available for Offline Sync".
- **Resource groups:** "Content Sync supports these resource groups: `quran_core`, `mushafs`, `translations`, `word_by_word_translations`, `word_by_word_transliterations`, `tafsirs`, `recitations`, `chapter_recitations`, and `articles`."
- **Quran text:** `quran_core:1` holds "canonical Uthmani verse text, word-level IndoPak Nastaleeq, IndoPak, Uthmani Tajweed, and Imla'i text, Surah metadata, and Juz/Hizb/Rub-el-Hizb boundaries". The core snapshot has "114 chapter, 6,236 verse, 83,665 word" records.
- **Word-level Uthmani** (needed for partial quotes): "For word-level Uthmani text, sync `mushafs:4` (Uthmani Hafs): its mushaf_word rows carry each word's Uthmani text in text (the same value as the Content API's word-level `text_uthmani`)".
- **Recitation timings** (useful for timing and checking): `chapter_recitations` holds "Chapter audio file rows and associated verse and word timing segment rows."
- **Only public resources:** "Bootstrap returns only public resources matching your filter. A snapshot request for a resource that is not public returns `snapshot_not_found` (404)." Which `translations:<id>` are public can only be checked with credentials (O12).
- **The basmala:** "Positioned words do not include surah headings or the bismillah". It is placed separately, which matches §5.5.

**What we need from QF:**

| Need | QF group | Status |
|---|---|---|
| Uthmani text with full diacritics | `quran_core:1` | syncable |
| Word-level Uthmani text (partial quotes) | `mushafs:4` | syncable |
| Translations | `translations:<id>` | syncable if QF marks the edition public; to confirm per edition (O12) |
| Reciter word timings | `chapter_recitations:<id>` | syncable |

**Fallback sources** (for anything QF doesn't offer offline, or while registration is pending):
- **Tanzil XML:** [licence](https://tanzil.net/docs/text_license) "Permission is granted to copy and distribute verbatim copies of this text, but CHANGING IT IS NOT ALLOWED." It can be used in apps "provided that its source (Tanzil Project) is clearly indicated", with a link to tanzil.net.
- **QuranEnc:** [API page](https://quranenc.com/en/home/api/) "Contents of the translations can be downloaded and re-published, with the following terms and conditions": no modification, credit the publisher and QuranEnc.com, mention the version number, keep the translation updated, no inappropriate advertisements.

**Obligations we take on:**
- **Attribution:** credit Quran Foundation, plus the translation edition name, wherever Quran text or translations appear:
  - the watch page's Subtitles info;
  - the editor footer;
  - the description of any export or social-media post.
- **Sync job:** runs **daily**, which beats the "at least every 7 days" rule. After each sync it rebuilds the index and re-renders any published track whose ayat changed. Changes are audited.
- **Developer Console:** keep an active account (O12).
- **Subtitle files must not become a data feed.** VTT files with Quran text are served to our player and embeds. We don't offer a bulk transcript or VTT download API. Whether a per-video "download subtitles" button counts as "offering QF Content … as data" is a question for QF (O13). Until answered, Quran-bearing tracks have no download button.
- **Never used:** The Clear Quran (needs written consent from the publisher), Tanzil translations ("for non-commercial purposes only", https://tanzil.net/trans/), and alquran.cloud ("any non-commercial purpose").

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
  | P3 | DeepL (text and Voice; the owner has API Pro), ElevenLabs Scribe after measurement |
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
| **P0: foundations** | provider interfaces plus Workers AI adapters; QF Developer Console registration and a Content Sync job (`quran_core:1`, `mushafs:4`, chosen `translations`), at least every 7 days, with index rebuild; the zero-mistake detector with unit tests on the R§8 clips; glossary tables plus seed; `TRANSLATION_CACHE`; `entitlement_grants`; catalogue keys | detector reproduces R§8: 0 wrong ayat, 0 extra words; sync job green; attribution visible |
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
| O1 | ElevenLabs key: which plan do we have, and may we measure Scribe on the same clips (a few cents)? | Yes; it becomes an option only if it beats DeepL Voice on Arabic and Quran |
| O2 | DeepL: stay on API Pro or move to Growth? | Stay on **Pro** (no volume cap). Growth only pays off above ≈ 1M characters a month (§7.3). Add a `deepl-api-key` to Secrets Store (`AI_KEY_DEEPL`) when P3 starts |
| O3 | Caption-minute allowances per tier (§6.1 seeds) and pack prices (§6.3) | Accept the seeds; admins can edit them |
| O4 | Captions monthly budget | $100/month (≈ 1,700 h on the default stack), inline translation $20 |
| O5 | Inline title translation free with fair use, or metered | Free with fair use (§6.4) |
| O6 | Viewer-side machine-translated titles (labelled, cached, never overwriting) | Yes, after P3, opt-out per channel |
| O7 | Default Quran translation editions per language | en: Saheeh International via QF sync if public there, else QuranEnc `english_saheeh`; alternative `english_rwwad`; ar: the Uthmani text itself |
| O8 | Extract the CMS provider layer into a shared package now, or mirror it | Mirror in P0–P2, extract once both use it |
| O9 | QuranEnc follow-up, only if it is used as fallback: may footnote markers "[n]" be hidden? | Email before P3 |
| O10 | "ﷺ" symbol in Arabic subtitles: off by default (keep the spoken words), per-channel setting | As recommended |
| O11 | On-device transcription in native desktop Studio as a free path (D10 hybrid) | Yes, in P5 |
| O12 | Register a Quran Foundation Developer Console app (production access, Content Sync scopes) and confirm which `translations:<id>` are public for sync | Yes, now. It blocks P0 |
| O13 | Ask QF: are per-video VTT downloads that contain Quran text "offering QF Content as data"? Is our private matching index fine as a Derived Material kept in step with the sync? | Email developers@quran.com with the P0 registration |
| O14 | Every Quran span needs creator confirmation before publish (no auto-publish of Quran), with "Publish without Quran text" (reference only) as the escape hatch | Yes: this is what makes "zero mistakes" a guarantee rather than a statistic |
| O15 | DeepL Voice as the paid high-accuracy STT and the Quran second opinion on higher tiers | Yes, behind the per-provider cap; never for speech-to-speech of Quran |
