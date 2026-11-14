# Transcription, translation and inline metadata translation (Quran-aware)

**Status:** Draft v1 for review
**Date:** 2026-11-11 (v2 the same day: zero-mistake Quran design, QF Content Sync as the Quran source, measured DeepL, full price comparison); v3 2026-11-13: owner go for the build with mode A, Arabic text from our Content Sync copy (§5.5.1)
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
| Speech-to-text, high accuracy | **ElevenLabs Scribe v3 is the preferred optional provider**, ahead of DeepL Voice. Both are **off by default** (2/13) and never used in tests, QA or stage (§7.5). **Production use of Scribe needs an ElevenLabs plan upgrade:** the current key is test-only. DeepL stays available on the existing API Pro plan | Measured 2026-11-11 (R§14): Quran recitation WER 1.1–1.4%, and **all 54 recited ayat auto-suggested with 0 wrong**, including Abdul Basit mujawwad (25/25 vs Workers AI 16/25, DeepL 7/25). Lectures 4.1% (reference bias against it, R§14). Batch API answers in 2–5 s per clip; $0.20/h vs DeepL $1.85/h |
| Not used | Bunny built-in transcription ($0.10 per language-minute, Whisper-based, no glossary); Cloudflare Stream captions (no Arabic); Workers AI nova-3 (no Arabic); Media Transformations audio extraction ($0.03/min, 10-minute limit) | R§2, R§5 |
| Transcript translation | **DeepSeek V4.1 Flash** on Workers AI, falling back to Gemma 4 26B | Cue-accurate and honorific-correct at $0.0004 per video-minute. It is already the CMS default (R§3.2). |
| Inline title/description translation | **Gemma 4 26B** on Workers AI, falling back to DeepSeek V4.1 Flash. DeepL is an optional adapter. | p50 1.0 s, p95 2.1 s, $0.00002 per title, quality equal to DeepSeek (R§3.1) |
| Premium translation path | **DeepL API Pro** with a glossary, opt-in on higher tiers (transcripts and titles) | Measured: fastest (titles p50 0.56 s), and its glossary fixed names and terms. It also made meaning slips the default didn't: «فصامه موسى شكرا» → "so thank you"; "He is the One" → «هو المخلص»; «نشيد» → «أغاني» without the glossary. Quran stays masked either way (R§9). |
| Dubbing (later) | DeepL speech-to-speech is technically viable (a 52 s clip became a 59 s English voice track) | It spoke a machine translation of the ayat. Quran spans must keep the original audio and are never synthesised (principle 3). |
| Never | m2m100 (unusable: invented hadith, repetition loops), gpt-oss (answers instead of translating) | R§3.1, CMS §1.5 |
| Quran display | **Official text only, never ASR**: a span shows the stored official text for an exact word range after creator confirmation, or a reference with no text | Measured 0 wrong ayat and 0 extra words on 20 clips (R§8) |
| Quran source | **quran.com (Quran Foundation) only**. Captions store references. **The Arabic text comes from our Content Sync copy** (owner 2026-11-13, §5.5.1); translations are fetched live (edge cache ≤ 7 days). No fresh copy → reference plus a quran.com link | Owner rule. Content Sync is the permitted path for an offline copy (§9.4) |
| Quran identification | **Mode A** (local index from the Content Sync copy; owner go 2026-11-13). Mode B is not used: the `search` scope is not granted | Measured: mode A 27/55 auto, 0 wrong, 0/20 false. A full-Quran index built from regular API responses isn't allowed (§5.5) |
| Quran translations | QF `translations` by id, fetched live. **Each channel picks its edition per language** from the QF list; platform default Saheeh International (en), changeable by admins; edition name shown (O7) | quran.com only |
| Metering | One "caption minute" per video-minute per language produced; plan allowance plus add-on packs plus admin grants | §6 |
| Inline title translation | **Free on every tier with a daily fair-use limit** (decided O5); the $20/month budget is the backstop | 100,000 title translations cost about $2–7 (§6.4) |
| Cost at scale | 1,000 h/month of jobs ≈ **$59** with the default stack; 10,000 h ≈ $590, which breaks the cap, so it is bounded by tier minutes and a budget stop | §7 |

## 2. Principles

1. **On demand, never automatic.** Nothing is transcribed or translated unless a creator (or an admin acting for them) asks. The "transcribe after processing" upload flag counts as asking.
2. **Never silent.** Machine output is a **draft** until the creator publishes it. Inline translations are **suggestions** in the form. Machine text shown to viewers is labelled.
3. **Quran is never machine-written.** ASR text is never shown for Quran, and Quran is never machine-translated or machine-spoken (no text-to-speech or dubbing of ayat). Only the official text from the synced store is rendered, after creator confirmation. Translations are recognised editions with attribution.
4. **Workers AI first.** Third-party providers are pluggable adapters. An admin turns them on per environment, and their keys live in Secrets Store (product constraints).
5. **Tier-aware.** Every limit is an Epic 27 entitlement key edited in admin-web. Nothing is hard-coded.
6. **Inside the $500/month cap.** A hard monthly budget per environment stops spending and queues work. It never fails jobs silently. Tests never spend it: automated suites use mocked providers (§7.5).
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
  - **"Confirm all suggested"** accepts every high-confidence match at once. Unsure matches publish as a reference with a quran.com link.
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
- If a title quotes an ayah, usually inside `{…}`, the suggestion adds the **reference**. For example, «آية استوقفتني (12) {إنَّ الحَسَنَاتِ يُذْهِبْنَ السَّيِّئات}» → "A Verse That Stopped Me (12) {…} (Hud 11:114)".
- The editor previews the QF translation fetched live. It goes into the stored title only once QF permission covers storage (O13), because quran.com is the only Quran source (§5.5).
- We measured 10 of 13 verse titles found uniquely, 2 correctly flagged as appearing in two places, and 1 missed (R§4).

**Viewer side (decided O6)**
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
5. **Honorifics (decided O10):** Arabic transcripts keep the spoken form («صلى الله عليه وسلم»). A per-channel setting "Show ﷺ symbol in Arabic subtitles" is off by default.

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

**quran.com is the only Quran source (owner, 2026-11-11)**

Owner's words: "quran should only be from quran .com". Every Quran text and translation we use comes from the Quran Foundation (QF) API, and from nowhere else: not Tanzil, not QuranEnc, not ASR, not MT.

| Step | What | Source | Rule |
|---|---|---|---|
| **1. Identify** which verses and words were said | a transient lookup during an on-demand job | QF only (see "Identification modes" below) | local matching decides; QF search can suggest |
| **2. Store** | what is kept in R2 drafts, published VTTs and the transcript index | **references only**: `(surah, ayahStart, wordStart) → (surah, ayahEnd, wordEnd)`, the chosen translation id (a QF `translations` id, e.g. Saheeh International), our own timestamps and the creator's decision | **no Quran text in our captions** until QF permission or Content Sync covers storage (O13) |
| **3. Display** | what viewers see | text **fetched live from QF** each time the passage is shown, through our API | edge cache ≤ 7 days; if QF is down, show the reference plus a quran.com link |

**Display at playback**
- **What the VTT holds:** a published Quran cue carries a marker, not text. For example, `quran:67:1:1-67:5:12;tr=20`, plus the reference label "Al-Mulk 67:1–5" / «الملك ١–٥».
- **Fetching the text:** the player (web, embeds, native) asks `GET /api/quran/passage?range=67:1:1-67:5:12&tr=20`.
  - api-videos calls the QF Content API with the server-side token (§10.1): verses by key or range with `text_uthmani` and word-level text for partial ranges, and the translation by resource id.
  - It returns only the requested words and the translation, with the attribution string.
- **Caching:**
  - The response is cached at the edge (Cache API / CDN) with `s-maxage` of at most 6 days and no permanent copy.
  - The Developer Terms prohibit storing QF Content "longer than 1 week unless it is obtained and maintained through the Content Sync APIs".
  - Per-passage responses expire well inside that. We never assemble a full copy from regular API responses: "do not build an offline copy from regular API responses".
- **When QF fails** (5xx, timeout, or 401 after the one retry): the cue shows the reference only: «الملك ٦٧: ١–٥» with a link `https://quran.com/67/1-5` ("Read on quran.com"). The player never falls back to ASR or any other source.
- **Translated tracks** use the same marker. The player fetches the chosen translation edition for that range from QF.
  - A **partial quote** shows the edition's translation of the full ayah, labelled "(part of 67:2)", because translations exist per ayah.
  - A language with **no QF edition** shows the reference and link only.
- **Search index** (§5.10): Quran cues are indexed by reference ("67:1–5"), not by text.
- **Titles** (§3.4): until permission, a title suggestion keeps the creator's Arabic quote and adds the reference, «… (الملك ٦٧:٢)» / "(Al-Mulk 67:2)". The editor can *show* the QF translation as a preview. Pasting it into the stored title waits for O13, because a title is stored permanently.
- **Attribution:** "Quran text and translations: Quran Foundation (quran.com)" and the edition name, shown in the player's Subtitles info and in the editor.

**Identification modes**

The terms decide which mode is allowed. A local match index is a "Derived Material": the definitions list "indexes, embeddings" and say an output that "permits reconstruction of QF Content remains subject to the restrictions on that content". A normalised full-Quran index permits reconstruction, so it must follow the storage rules:
- **Not allowed:** building it from regular API responses, even for under a week. Its source, `quran_core`, is Content Sync-available: "If a content resource is available through Content Sync, Content Sync is the only permitted path for obtaining and maintaining an offline copy of that resource; do not build an offline copy from regular API responses."
- **Allowed, mode A (available on production now; §10.1):** a **local index built from the Content Sync copy** of `quran_core:1` (plus `mushafs:4` for word-level Uthmani), kept in step by a sync at least every 7 days and rebuilt after each one. This needs QF to grant Content Sync, which the Content Sync docs describe as "approved production access" for the complete `quran_core` (O12).
- **Allowed, mode B (needs the `search` scope, not yet granted): per job, no stored index.** For each candidate stretch of the transcript:
  1. QF Search (top 10);
  2. fetch those candidate verses by key from the Content API (kept only for the job, and at most 7 days in cache);
  3. our matcher verifies the ASR words against each candidate.
  - **Auto-suggest** only when exactly one candidate passes (≥ 6 matched words, ≥ 0.75 of the stretch, ≥ 0.9 inside the span).
  - **Measured** on the same 55 noisy per-ayah snippets and 20 non-Quran snippets:

    | Mode | Auto-suggested | Wrong | Non-Quran auto-suggested | Correct suggestion inside review | API calls |
    |---|---|---|---|---|---|
    | **B: QF search + fetch + verify** | **22/55, 0 wrong** | 0 | 0/20 | 17 of the 33 others | 64 searches + 519 verse fetches for 75 snippets |
    | A: local index (measured with the same matcher on an equivalent text) | 27/55, 0 wrong | 0 | 0/20 | | 0 |

  - Mode B is a little less complete than A (and much chattier) but just as safe. In production, verse fetches are deduplicated per job, and the edge cache serves repeats.
  - **Private videos** still go through mode B. It sends short ASR snippets to QF, which the owner accepts by choosing quran.com as the only source. This should be listed in the privacy policy.
- **Whole-transcript recall:** the 87% auto-suggest rate (R§8.3) was measured with a full local index (mode A behaviour). It becomes the expected rate once Content Sync is granted.

**Not used as Quran sources** (owner rule): Tanzil, QuranEnc, alquran.cloud, Tarteel/QUL, and any ASR or MT output. The research measurements used the Tanzil text only as a test reference (R§8).

**Pipeline**
1. **Quran text for matching (QF only):**
   - **Mode A:** a local normalised index built from the Content Sync copy, rebuilt after each sync.
   - **Mode B:** per-job candidates from QF Search plus Content API fetches (above).
   - The basmala is never glued to ayah 1 (QF: "Positioned words do not include surah headings or the bismillah"). The Tanzil TXT export showed this failure in testing (R§8.2).
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

7. **Accepting** stores `(surah, ayahStart, wordStart) → (surah, ayahEnd, wordEnd)` and the translation id. No Quran text is stored; the player fetches it live from QF (above). The creator can't edit it.
   - **"Confirm all suggested":** one button accepts every `confirmed` and `context` span at once, showing a count and the list of references. `review` spans are untouched.
   - **Rejecting** offers two choices:
     - "Not Quran": the ASR text stays as ordinary speech.
     - "Different reference": a picker; the text again comes from the store.
   - **Before publishing:** every `confirmed`/`context` span must be confirmed (one by one, or with "Confirm all suggested").
   - **Spans still in review at publish** are published as **reference only** ("Possible Quran: Al-Baqarah 2:143", with a quran.com link). They never show text.
8. **Second opinion (optional provider, off by default).** For recitation videos where coverage is under 100%, the Quran spans alone are re-run through a second ASR. **ElevenLabs Scribe v3 measured best**: Ar-Rahman mujawwad 25/25 ayat (Workers AI 16/25, DeepL 7/25), al-Fajr 16/16. DeepL Voice is the alternative.
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

### 5.5.1 As built (2026-11-13, PR "Quran foundations")

Owner decisions 2026-11-13: build with **mode A**; the **Arabic text is served from our daily Content Sync copy**; translations stay live; captions store references only; QA and stage sync from **production QF** with the production client, each into its own bucket; tests use fixtures only.

- **Resource:** `quran_core:1` only. The ayah text is the verse row's `text_uthmani`, verbatim. Word-level text (for partial ayat) is that same text split on spaces, a token with no letter (pause or section mark) staying with its neighbour; a verse whose token count differs from its `word` rows fails the build. `mushafs:4` is not used (its documented `text` is a font glyph in the QF example).
- **Word numbers** in references are the order among the verse's `word` rows (markers excluded), the same on the index and the text side.
- **Job:** processor `src/quran/` — `QuranContentSync` message (type 260) on the videos queue, queued by the daily cron (`41 3 * * *`) and by the Errors page's **Sync now** (`POST /internal/quran/sync`, X-API-Key). It reads QF's change feed for `quran_core:1` (bootstrap the first time or on `resync_required`), and on any change other than `RESOURCE_UPDATE` (or no copy yet) streams the snapshot record by record, builds the text and index, and switches `quran/current.json` to the new version last. The sync token moves only after the copy is written. Two versions are kept.
- **Storage:** private media bucket (`al-ummah-now-media-private[-stage|-qa]`, processor `REVIEW_MEDIA`, api-videos `MEDIA_PRIVATE`): `quran/current.json`, `quran/state.json`, `quran/text/<version>/<surah>.json`, `quran/index/<version>.json`.
- **Failures:** 429/5xx/network back off on the queue (≥ Retry-After, 1 → 30 min) and then go to the DLQ (stored, flagged with Replay). A failure no retry fixes (not configured, a verse failing the check, `RESOURCE_DELETE`) flags the admin at once (`quran-sync`, Sync now). A copy not synced for 7 days is deleted by the daily check and flagged (`quran-stale`); nothing serves a stale copy.
- **Secrets:** `QF_CLIENT_ID` / `QF_CLIENT_SECRET` from Secrets Store `quran-foundation-prod-client-{id,secret}` in production, stage and QA; vars `QF_OAUTH_HOST`, `QF_API_HOST`. Tests inject a fake QF; the client refuses the real network under test, CI or E2E.
- **Matcher:** `packages/shared-types/src/quran.ts`, a port of `quran_zero.py` (detect2, resolve, classify2) with two stricter rules: extension keeps the longest prefix that clears the 0.75 bar (a noisy tail never sinks a clean span), and a span never crosses a surah boundary. Output is references with a class (`confirmed`, `context`, `basmala`, `review`) and times.
- **Passage API:** `GET /api/v1/quran/passage?range=67:1:1-67:5:12` → whole ayat verbatim, partial ayat by word, label, quran.com link, attribution; 503 with no fresh copy.

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
          "source": "qf", "translationId": null,          // no Quran text is stored; the player fetches it live
          "confidence": 0.95, "status": "confirmed" | "context" | "basmala" | "review" | "accepted" | "rejected",
          "alternatives": [] }
      ] }
  ]
}
```
- In translations, a `quran` segment carries `translationId` (a QF `translations` resource id) and **no text**. The player fetches the text live (§5.5).
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
- `quran_translation_defaults` (admin config): `lang`, `qf_translation_id`, `title`, `attribution`, `enabled`, `is_default`.
- `channel_quran_translations` (channel setting, O7): `channel_id`, `lang`, `qf_translation_id`. Picked in Studio → Settings from the QF translations list, with search; it falls back to the platform default.

**KV `TRANSLATION_CACHE`:**
- **Key:** `sha256(normalisedSourceText, srcLang, tgtLang, glossaryVersion, promptVersion, model)` → `{ text, provider, model, at }`.
- **TTL:** 90 days.
- **Used by:** inline translation, viewer-side metadata and repeated cue batches.

### 5.6.1 As built: caption drafts (2026-11-14)

- **Types:** `packages/shared-types/src/captions.ts`. A cue is `{ id, startMs, endMs, segments[] }` (integer milliseconds). A `quran` segment holds `range` (`surah:ayah:word-surah:ayah:word`), `status` (`confirmed` | `context` | `basmala` | `review` from the matcher, or `accepted` once the creator confirmed it), optional `alternatives`, and `heard` (what speech-to-text heard). `heard` is never rendered: it exists so "Not Quran" can turn the span back into speech.
- **Storage:** subtitles bucket, `<videoId>/drafts/<lang>.json` (the draft, `version` +1 per save) and `<videoId>/drafts/<lang>/v<n>.json` (each published version, for a translation's `sourceVersion`). The track's status lives in the existing `metadata.json` (`SubtitleTrack.origin` = `upload` | `machine` | `machine_edited`, `version`), so no D1 `caption_tracks` table was needed. Video deletion already removes the whole `<videoId>/` prefix.
- **API (api-videos, owner or `video.edit`):** `GET /api/videos/:id/captions/drafts`, `GET|PUT|DELETE …/drafts/:lang`, `POST …/drafts/:lang/publish`. Saves and publishes name `baseVersion`, the version the editor loaded; a changed draft is 409 `draft_conflict`. Publishing over a track the creator uploaded in the same language is 409 `replaces_upload` unless `replaceUpload: true`.
- **Published track:** the stored WebVTT has a marker per Quran span (private-use characters, stripped from any text a client sends, so they can't be forged). `GET /subtitles/:lang` fills them as it serves: an accepted span becomes `﴿official text﴾ (surah name 3:166–167)` from our Content Sync copy; a suggestion, or any span when there is no fresh copy, becomes `[Quran 3:166–167 · quran.com/3/166-167]`. No Quran text and no ASR text of a Quran span is stored in the track. The copy version is part of the ETag.
- **Passage API:** also takes whole ayat as typed (`3:166` or `3:166-167`) and returns the full word range; Studio's "Different reference" uses it.
- **Studio:** Subtitles section → **Caption drafts** (status, origin, Quran suggestions left, Edit / Publish / Delete) and the editor: cues beside the video (click a time to play from it; the playing cue is highlighted), text edits, ±0.1 s nudges, split at the cursor, merge with next, delete, find and replace (speech only), undo/redo, autosave, and per span Confirm / Not Quran / Different reference / the alternatives, plus "Confirm all suggested" (confident classes only; `review` stays for a look). A confirmed span shows the official text with attribution; a suggestion shows only its reference and a quran.com link.

### 5.6.2 As built: the review transcript as a draft (#1296, 2026-11-14)

- **Offer:** while the video review's transcript is still stored (`review/…/transcript.json`, purged after 30 days), Studio's Caption drafts shows **Automatic transcript → Use as caption draft** with the language spoken. `GET …/captions/drafts` returns `{ drafts, claims, transcriptAvailable }`.
- **Request:** `POST /api/videos/:id/review/transcript/claim` `{ language, replace? }` (owner or `video.edit`) writes a claim marker (`<videoId>/claims/<lang>.json`, status `queued`) and queues `CaptionClaimTranscript` (261) on the videos queue: 202. A draft in that language is 409 `draft_exists` unless `replace` (Studio asks first); a claim already queued is 409 `claim_pending`; no transcript is 404 `transcript_not_found`.
- **Job (processor):** reads the transcript, runs the AUN-CAPTIONS matcher over it with our Quran Foundation copy and writes the draft (`origin: review_transcript`): speech stays one cue per transcript segment, each matched span becomes its own Quran cue holding only the reference (`heard` kept for "Not Quran"). No fresh copy of the Quran text: no draft, the job retries (2, 4, 8 min). The last attempt marks the claim `failed` and flags the admin (Errors page, key `caption-claim:<videoId>:<lang>`, **Try again** = `POST /internal/captions/claim` on the processor); a later success resolves it. A purged transcript or a draft written meanwhile is the creator's outcome (`transcript_gone`, `draft_exists`), shown in Studio, not an admin item.
- **Studio:** a queued claim shows "Preparing the … draft" and the panel checks back every 8 s; a failed one says why with Try again (Replace for `draft_exists`). The draft then opens in the same editor as any other, and nothing from it reaches viewers until the creator publishes.

### 5.6.3 As built: on-demand transcription jobs (2026-11-14)

- **Request:** `POST /api/videos/:id/captions/jobs` `{ language, replace? }` (owner or `video.edit`; the video `ready` with a duration). One active job per `sha256(videoId|transcribe|language|provider)` (a partial unique index on `caption_jobs`, SEARCH_DB migration 0033): asking again returns that job (200) and charges nothing. A draft in that language is 409 `draft_exists` unless `replace`. The job reserves `ceil(duration/60)` caption minutes from the channel owner (§6.3.1, hold id = job id); out of minutes is 402 `upgrade_required` with `entitlement: captions.monthlyMinutes`, `minutesNeeded` and the usage. A job that cannot be queued is failed and refunded (503). `GET …/captions/jobs` lists the newest 20, `POST …/captions/jobs/:jobId/cancel` cancels and refunds (409 `job_finishing` once the draft is being written: the processor's `postprocessing` report and the cancel are both conditional, so exactly one wins and no draft is ever free; a job stuck there 90 minutes without progress, past the processor's whole retry window, may be cancelled, and progress never moves a job back out of `postprocessing`), `GET …/captions/minutes` returns the usage and what this video would take.
- **Audio:** the video review's chunks (`review/<videoId>/<rev>/manifest.json`) while the review media still hold them; otherwise the media transcoder extracts audio only (`caption_audio` on TRANSCODE_QUEUE, DO `captions:<videoId>`, container `POST /audio`) from the kept R2 original or Bunny's source into `captions-work/<jobId>/` (16 kHz mono MP3, ≤ 10-minute chunks, the review format; no silence cut or overlap) and reports to `POST /internal/captions/jobs/:jobId/audio`. A video with no audio track fails the job (`audio_unavailable`) without an admin item; any other extraction failure flags the admin. api-videos deletes `captions-work/<jobId>/` when the job ends or is cancelled, and anything a late extraction writes after a cancel.
- **Speech-to-text (processor `captions/job.ts`, `CaptionJob` 262 on the videos queue):** one chunk per delivery, in order, then the message goes on for the next chunk, so a batch stays inside the consumer's time limit and a retry resumes at the failed chunk; the partial transcript (`captions-work/<jobId>/transcript.json`) is written only over the copy the delivery read (etag), so a duplicate delivery never forks the job. Whisper (`@cf/openai/whisper-large-v3-turbo`, admin model override in `global_settings` `captions/settings.json`) runs with the language, `vad_filter:false`, `condition_on_previous_text:false` and the title as `initial_prompt`; tests, CI and E2E can only use the fixture (`CAPTION_PROVIDER`/`REVIEW_PROVIDER=fixture`). Each chunk reserves its cost from the day's caption budget (`ai_budget_daily`, feature `captions`; the monthly budget, default $100 production and $5 elsewhere, ÷ 30, carried on the message); when it is spent the job shows `waiting_budget`, asks again in an hour, and the admin gets one item per day (`caption-budget:<day>`).
- **Post-processing and draft:** phantom phrases (`CAPTION_PHANTOM_PHRASES`) and word loops (the same 1–4 words 4+ times) are dropped; three or more identical segments in a row are kept once (two stay: a reciter may repeat an ayah). Then the matcher and the same draft writer as §5.6.2 (`captions/draft.ts`), `origin: transcription`, `machine: { provider, model }`. No fresh copy of the Quran text: the step retries. Nothing left after the filter is `no_speech`. `ready` commits the minutes actually used (the audio's started minutes), the rest comes back.
- **Progress and failure:** the processor reports `transcribing` (chunks done/total) and `postprocessing` to `POST /internal/captions/jobs/:jobId/progress|finish`; a 409/404 (cancelled, erased) stops the work. Retries back off 1, 2, 4 min; the last attempt fails the job (refund) and flags the admin (key `caption-job:<jobId>`, **Try again** = `POST /internal/captions/jobs/retry` on api-videos, which runs it again free of charge, `waived`); a later success resolves it. A retry is dismissed when the video is gone or a newer job of it runs. Erasing a user deletes the jobs they paid for; jobs they asked for on someone else's minutes stay with the payer with `requested_by` anonymised, and one still running is cancelled with the payer's minutes released. A stopped job's work is deleted by the processor too.

### 5.7 Translation of transcripts
- **Input:** always the **corrected, published or latest draft source**, never raw ASR, and recorded as `sourceVersion`.
- **Masking:** Quran segments (accepted, or suggested and not rejected) are replaced by tokens `⟦Q1⟧`. The model is told to keep tokens verbatim.
- **Batches:** cues are sent as a JSON array, at most 6,000 characters per call (the CMS-proven chunk size), with the previous 3 cues as read-only context.
- **Output validation:** the array is the same length, every token is present exactly once, the output is in the target script, and the length ratio is between 0.4 and 2.5. On a failure: retry once, then use the fallback model, then fail the batch.
- **Quran tokens:** the translated track keeps the reference marker for each Quran span. The player fetches the chosen QF translation edition live (§5.5). No translation text is stored, and Quran is never machine-translated.
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

### 5.9 Viewer-side metadata translation (decided O6)
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

| Key | Type | Meaning | Value per plan |
|---|---|---|---|
| `captions.monthlyMinutes` | number | caption minutes per month (1 per video-minute per language produced) | **set by the site-wide subscription plan (pending)** |
| `captions.maxTargetLanguages` | number | translation targets per job | set by the site-wide subscription plan (pending) |
| `captions.highAccuracy` | boolean | may use an admin-enabled optional provider (e.g. DeepL) | set by the site-wide subscription plan (pending) |
| `captions.editor` | boolean | transcript editor | set by the site-wide subscription plan (pending) |
| `translate.inline.dailyItems` | number | inline translations per user per day (fair use) | on every tier (O5); the daily limit is admin-editable |
| `translate.bulk.maxItems` | number | items per bulk translate | set by the site-wide subscription plan (pending) |
| `translate.viewerAuto` | boolean | channel's titles may be auto-translated for viewers (if O6) | set by the site-wide subscription plan (pending) |

**Owner decision 3/13 (2026-11-11):** "what free tier? this needs planning with all subs on the site".
- There are no per-tier numbers here. Allowances and pack pricing are **set by the site-wide subscription plan (pending)**, which covers every subscription on the site.
- **Until that plan exists, captions are available only through admin grants** (§6.3). Every plan's code default for `captions.monthlyMinutes` is `0`. Exception (O5): inline title and description translation is free on every tier with a daily fair-use limit. `translate.inline.dailyItems` has a non-zero code default that the site-wide plan may tune.
- The cost facts the plan needs are in §6.4 and §7.

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
- **Pack pricing:** set by the site-wide subscription plan (pending). For that planning, here is our cost per 1,000 caption minutes:

  | Stack | Our cost per 1,000 caption minutes |
  |---|---|
  | Default (Workers AI) | ≈ $0.48 (transcription ≈ $0.56, translation ≈ $0.40) |
  | DeepL Voice STT (optional) | ≈ $30.8 |
  | DeepL translation (optional) | ≈ $16.7 (609 characters per minute × $27.50 per 1M) |
  | ElevenLabs Scribe (not measured) | ≈ $3.4 |

  Optional-provider jobs should count at a multiple of the default that matches their cost ratio (§7.4). The multiple is for the plan to set.

### 6.3.1 As built: caption minutes (owner decision 2026-11-14)

The owner chose **a tier allowance plus admin grants**, both in the videos admin (never Auth RBAC). This replaces the `entitlement_grants` table proposed above until site-wide subscriptions exist.
- **Tier:** each creator tier has **Caption minutes per month** (`creator_tiers.caption_minutes_month`). The shipped Creator tier starts at 0. Unlimited tiers, and the super admin, have no limit. It is edited on the admin's Creators → Tiers page.
- **Grants:** on the admin's user page → **Caption minutes**. An admin with `creators:manage` grants N minutes either for **this month only** or **until used** (spent after the monthly allowance, in any month). A reason is required. Revoking also needs a reason: unused minutes stop counting, and used ones stay used. Every grant and revoke is audited (`site_settings_log`, `content:user:<id>`, actions `caption-grant` / `caption-grant-revoke`).
- **Metering (SEARCH_DB, migration 0032):**
  - `caption_minute_usage` holds the minutes of the month's allowance per subject and month (UTC).
  - `caption_minute_grants` holds the grants.
  - `caption_minute_holds` holds one reservation per job: what it took from the month and from each grant.
- **Who pays:** the subject is the tier holder that `resolveCreator` names: the channel owner, or a super admin themselves.
- **Reserve, commit, release:** a job's minutes are reserved when it is requested, from the month first and then from "until used" grants, oldest first. Each update is conditional, and a lost race is undone and retried, so a subject is never charged past a limit or twice for the same job. When the job finishes, the minutes used stand and the rest is given back (grants first). A failed or cancelled job gives back everything, once.
- **Account erasure** deletes the user's usage, holds and grants.
- Code: `packages/shared-types/src/caption-minutes.ts`, `apps/api-videos/src/lib/captions/minutes.ts`.

### 6.4 Inline title translation: free with fair use (decided O5)
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
| ElevenLabs Scribe v3 | $0.20 (+ 20% for keyterms), within plan hours | measured: best on Quran; needs a paid plan for production (§7.3a) |
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

### 7.3a ElevenLabs plan needed for production Scribe

The owner said: "this is for testing only, if we want to use it we need a higher plan". [Pricing page](https://elevenlabs.io/pricing/api), fetched 2026-11-11, for Scribe batch STT at **$0.20/hour**:

| Plan | Price per month | Scribe batch hours included |
|---|---|---|
| Starter | $6 | 30 h |
| Creator | $22 | 110 h |
| Pro | $99 | 495 h |
| Scale | $299 | 1,495 h |
| Business | $990 | 4,950 h |

- **The page doesn't say whether usage beyond the included hours is allowed on each plan.** Confirm with ElevenLabs before relying on it.
- **Choosing a plan:** Scribe is an optional provider for a share of jobs, so size the plan to the expected optional volume:
  - up to ~100 h/month → **Creator, $22**
  - ~100–500 h → **Pro, $99**
  - ~500–1,500 h → **Scale, $299**
- **Quran second opinion only:** using Scribe just as the second check on Quran minutes (§5.5 step 8), at about 10% of 1,000 h, fits Creator.
- **Budget:** the plan fee counts against the AI budget (§7.4).

### 7.4 Where the $500 cap bites, and how it stays sustainable
- **Default stack:** 10,000 h/month (~$590) alone breaks the cap. The platform also pays for delivery, workers and other AI.
- **Captions budget (decided 4/13):** `monthlyBudgetUsd` defaults to **$100** (admin-editable, max $500), the same pattern as the CMS. Inline translation has its own **$20** budget, also admin-editable. That buys ≈ **1,700 h/month** on the default stack, ≈ 450 h on Scribe, or ≈ 96 h on DeepL Pro translation.
  - **Daily slices:** spending is recorded in the existing `ai_budget_daily` with feature `captions`, plus `inline-translate` with its own $20 default. A daily slice (monthly ÷ days remaining × 1.5) stops one day's spike from using the whole month.
  - **When reached:** new jobs go to `waiting_budget` with the en/ar message "Busy right now; your subtitles will start within 24 h". Reserved minutes aren't charged while waiting. An admin alert goes through the cost-monitoring hooks (AUN-COST).
- **DeepL jobs** (high-accuracy STT, DeepL translation) use their own per-provider monthly cap (§10). On a tier that includes them, they use **caption minutes at 30×** (DeepL Voice STT) and **20×** (DeepL translation), matching their cost ratio to the default.
- **What bounds exposure:** the sum of all plan allowances and grants. For planning, 120,000 caption minutes a month ≈ $58 on the default stack.
- **Add-ons:** pricing comes from the site-wide subscription plan (pending). Any price at or above cost (above) makes extra volume self-funding.
- **Revisit:** when monthly usage passes 5,000 h, revisit the self-hosted GPU option from the 2025 research doc.

### 7.5 Hard rule: tests never burn the budget

Owner, 2026-11-11: "dont burn it on qa with testing".
- **Automated tests use mocked providers only.** CI, unit and E2E tests, the release suite, and stage tests never call a paid or metered provider: Workers AI, DeepL, ElevenLabs or the Quran Foundation API.
  - They use a **mocked provider** with recorded fixtures: transcripts, translations, QF passages and search results.
  - This follows the existing "E2E (local, mocked Workers AI)" job.
  - The mock is selected by environment (`AI_PROVIDER_MODE=mock` in test configs) or by a per-request test flag. The run accounts used by E2E (`e2e+…@e2e.alummahnow.net`) always get the mock.
- **Guard, which fails loudly:**
  - Every provider adapter checks the mode before any network call.
  - A request in test mode, or from an E2E run account, that would reach a real provider throws `RealProviderInTestMode`. It is reported as an error and returns 500, never silently passing.
  - A unit test asserts that the guard exists for every adapter.
  - `pnpm check:config` fails if a test or stage config has the real-provider mode for an automated suite.
- **Separate small budgets per environment:**
  - QA **$5/month** and stage **$5/month** (admin-editable), each with its own `ai_budget_daily` rows.
  - They never draw on production's $100 (captions) and $20 (inline translation) budgets.
  - When reached, QA and stage jobs wait in `waiting_budget` like production.
- **Real-provider smoke checks:** at most one small **manual** check per release, with a few seconds of audio and one title.
  - It runs only behind an explicit flag (`REAL_PROVIDER_SMOKE=1` plus a manual `workflow_dispatch`), never on PRs or schedules.
  - Its cost is logged against the environment's budget.
- **DeepL is never enabled on QA or stage by default.** An admin may turn it on there temporarily for a planned test, which is audited, and the $5 cap still applies.

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

**Quran Foundation (QF): Search for identifying; Content Sync for storage only once cleared (§5.5).**

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

**Not used** (owner rule: quran.com only): Tanzil and QuranEnc are no longer sources for stored or displayed text.

**Obligations we take on:**
- **Attribution:** credit Quran Foundation, plus the translation edition name, wherever Quran text or translations appear:
  - the watch page's Subtitles info;
  - the editor footer;
  - the description of any export or social-media post.
- **Sync job** (mode A, §5.5.1): runs **daily**, which beats the "at least every 7 days" rule, and rebuilds the text and the matching index after a change. If syncing stops for more than 7 days, the copy is deleted, the admin is flagged, and captions show references with a quran.com link until a sync succeeds.
- **Edge cache for displayed passages:** `s-maxage` of at most 6 days, never written to R2 or D1.
- **QF timing data** is never stored in captions (§5.5).
- **Developer Console:** keep an active account (O12).
- **Subtitle files must not become a data feed.** Our VTTs carry references, not Quran text, and the text is fetched live by our player and embeds. We don't offer a bulk transcript or VTT download API. Whether a per-video "download subtitles" button counts as "offering QF Content … as data" is a question for QF (O13). Until answered, Quran-bearing tracks have no download button.
- **Never used:** The Clear Quran (needs written consent from the publisher), Tanzil translations ("for non-commercial purposes only", https://tanzil.net/trans/), and alquran.cloud ("any non-commercial purpose").

## 10. Provider routing (admin-configurable)

- **Admin screen:** admin-web → AI → Captions & Translation, one row per environment. It mirrors the CMS `ai_settings` behaviour: version check, audit to `ai_settings_audit`, and keys referenced by Secrets Store name `AI_KEY_*`, never stored.
- **Per feature:**
  - **features:** `asr`, `transcript_translate`, `inline_translate`, `quran_lookup`
  - **routing:** primary `{provider, model}`, fallback, and per-language overrides (e.g. `asr.ar → deepl`, `inline_translate.fr → deepl`). **Workers AI is the default everywhere. DeepL (on the existing API Pro plan) is off until an admin enables it for an environment or a language** (owner decision 2/13)
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

### 10.1 Quran Foundation API configuration

The credentials were added 2026-11-11 to the al-ummah Secrets Store `f8eddc9944d041919ed8dc7d08d32308`.

| Environment | OAuth host | API host | Client id secret | Client secret secret |
|---|---|---|---|---|
| QA, stage | `https://prelive-oauth2.quran.foundation` | `https://apis-prelive.quran.foundation` | `quran-foundation-preprod-client-id` | `quran-foundation-preprod-client-secret` |
| production | `https://oauth2.quran.foundation` | `https://apis.quran.foundation` | `quran-foundation-prod-client-id` | `quran-foundation-prod-client-secret` |

- **Bindings:** the processor (jobs) and api-videos (inline title lookup) bind these through `secrets_store_secrets` in each `wrangler.<env>.jsonc`. The hosts go in vars (`QF_OAUTH_HOST`, `QF_API_HOST`), so `pnpm check:config` can assert that production never points at prelive. Add both names to `scripts/release/secrets-manifest.ts`.
- **Scopes (tested 2026-11-11 with both clients, through a throwaway probe Worker that bound the secrets and never returned tokens):**
  - **Granular scopes:** new Backend/server apps can't request `scope=content` (QF quickstart: "asking for `content` returns `invalid_scope`"). They request granular scopes, space-separated.

    | Scope | preprod client | prod client |
    |---|---|---|
    | `content` | `invalid_scope` | `invalid_scope` |
    | `content.quran.read` + `content.translations.read` | granted | granted |
    | `content.metadata.read` | granted | granted |
    | `content.sync.read` | granted | granted |
    | `content.audio.read` | granted | granted |
    | `search` | **`invalid_scope`** ("The OAuth 2.0 Client is not allowed to request scope 'search'") | **`invalid_scope`** |

  - **Verified calls (prod):**
    - `GET /content/api/v4/verses/by_key/67:1?fields=text_uthmani&translations=20` → 200, Uthmani text plus Saheeh International.
    - `…?words=true&word_fields=text_uthmani` gives word-level text for partial quotes. Note: word text can include pause marks, e.g. «عَمَلًۭا ۚ».
    - The search API with a content-only token → 403 `insufficient_scope`.
  - **Translation ids:** **Saheeh International = 20** (prod). Prelive has only 14 translations and **no 20**, so QA uses 85 (Abdel Haleem) and surahs 1–2.
  - **Content Sync works on production now** with `content.sync.read`. `bootstrap=true` returned `RESOURCE_CREATE` for `quran_core:1`, `mushafs:4` and `translations:20`, and snapshots return 200. Combined filters returned one resource per page, so follow `next_page_url`.
  - **Content Sync on prelive:** bootstrap returned nothing (partial dataset).
  - **What follows:**
    - **Mode A identification (a local index from the Content Sync copy) is available on production now.**
    - Mode B needs the `search` scope, which is missing. Until it's granted, QA, stage and production use mode A or the review flow.
    - Display stays live per the owner rule (§5.5): Content Sync would also allow storing, but the owner's decision for captions is references plus a live fetch until QF answers the email (O13).
  - **Client code:**
    - Request only the granular scopes it needs: `content.quran.read content.translations.read` for display; `content.sync.read` for the sync job.
    - If `@quranjs/api` is used, it must be ≥ 3.17 with `contentScopeMode: "granular"`.
    - Cache one token per scope set.
- **Prelive data:** prelive holds only part of the Quran ("its data covers only surahs 1–2" per the QF quickstart), so QA tests of QF search must use those surahs.
- **Token handling:**
  - `POST {QF_OAUTH_HOST}/oauth2/token` with `grant_type=client_credentials`, HTTP Basic auth, and the needed scopes (`search`, `content`), as listed in the Developer Console.
  - Every API call sends `x-auth-token` and `x-client-id`.
  - **Cache** the token in KV per environment and scope set for its lifetime (about 1 h; `expires_in` is 3600) and **renew early** at 50 minutes (or `expires_in` − 10 min).
  - A single in-flight refresh per isolate stops a burst of callers from each fetching a token.
  - **Retry once on 401:** drop the cached token, fetch a new one, repeat the call once. A second 401, or a 403 / insufficient scopes, fails that call with a typed `auth` error. The job then carries on without QF suggestions; it never fails the caption job.
  - **429/5xx:** exponential backoff, at most 3 attempts, then continue without QF.
  - Tokens and secrets are never logged.

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
| **P0: foundations** | provider interfaces plus Workers AI adapters; QF client (§10.1) with mode B identification and `GET /api/quran/passage` (live, edge-cached ≤ 6 days, quran.com fallback link); references-only Quran segments; mode A Content Sync index once granted; the zero-mistake detector with unit tests on the R§8 clips; glossary tables plus seed; `TRANSLATION_CACHE`; `entitlement_grants`; catalogue keys | detector reproduces R§8: 0 wrong ayat, 0 extra words; sync job green; attribution visible |
| **P1: inline title translation** | `POST /api/translate`; Translate buttons on title/description in the upload form, Studio editor and "Set values"; Quran-aware titles; fair-use counters | p95 ≤ 2 s on QA; 67-title set ≥ 90% acceptable; en/ar UI |
| **P2: on-demand transcription** | jobs API, queue, Container extraction, ASR, post-processing, Quran detection, drafts, editor v1, publish, metering with reserve/commit/refund, usage meter, 402 hard stop, budget stop, purge coverage | QA run on the 8 R§1 clips meets R§2 numbers; refund on forced failure; idempotent double-click |
| **P3: translation of transcripts** | cue-batch translation with Quran reference markers (translation fetched live from QF); retranslate on source change; bulk Transcribe/Translate; upload flag; admin grants UI | Quran cues never carry stored or MT text; attribution visible |
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
| O1 | ElevenLabs Scribe | **Measured 2026-11-11 (R§14), best on Quran.** It is the preferred optional high-accuracy STT, off by default, never in tests or QA. The current key is test-only (owner): production needs a plan (§7.3a). Secret `elevenlabs-api-key` to be deleted after the test |
| O2 | DeepL plan | **Decided 2026-11-11 (2/13):** stay on API Pro ($5.49/month), no upgrade. DeepL is optional and off by default; admins enable it per environment or language. Add the key to Secrets Store as `AI_KEY_DEEPL` when an admin first enables it |
| O3 | Caption allowances and pack pricing | **Decided 3/13:** set by the site-wide subscription plan (pending, planned with all subscriptions on the site). Until then, captions are available by admin grant only |
| O4 | Captions monthly budget | **Decided 4/13 (2026-11-11), as proposed:** captions $100/month and inline translation $20/month, both admin-editable per environment (max $500); daily slices; on reaching the budget, jobs wait in `waiting_budget` and admins get an alert (§7.4) |
| O5 | Inline title/description translation | **Decided 2026-11-11:** free on every tier with a daily fair-use limit (`translate.inline.dailyItems`); the $20/month inline-translation budget is the backstop |
| O6 | Viewer-side machine-translated titles | **Decided 2026-11-11: yes.** Labelled "auto-translated", cached, never overwriting creator text; each channel can opt out (§5.9) |
| O7 | Quran translation edition | **Decided 2026-11-11:** each channel picks its edition per language from the QF translations list. The platform default is Saheeh International (en), changeable by admins. The edition name is shown on screen |
| O8 | Extract the CMS provider layer into a shared package now, or mirror it | Mirror in P0–P2, extract once both use it |
| O9 | (withdrawn: QuranEnc is no longer used) | – |
| O10 | ﷺ in Arabic subtitles | **Decided 2026-11-11:** keep the spoken words by default; each channel can switch on the ﷺ symbol |
| O11 | On-device transcription in native desktop Studio as a free path (D10 hybrid) | Yes, in P5 |
| O12 | QF API access | **Closed except Search (2026-11-11):** both clients get the granular Content scopes, and production Content Sync works. **Owner to request:** the **Search API** permission (`search` scope) for both the pre-production and production apps at https://dev-console.quran.foundation/projects. It is only needed for mode B and review suggestions |
| O13 | QF partner-permission email | **Sent 2026-11-11 to developers@quran.com, awaiting reply.** Until QF answers: references only, live fetch, edge cache ≤ 7 days, and identification as decided (§5.5) |
| O14 | **Decided 2026-11-11:** the creator confirms Quran spans before publish; "Confirm all suggested" covers high-confidence matches; unsure matches publish as a reference plus a quran.com link | Done |
| O15 | DeepL Voice for high-accuracy STT and the Quran second opinion | **Decided (2/13):** optional, off by default, enabled per environment or language by an admin under the per-provider cap; never used for speech-to-speech of Quran |
