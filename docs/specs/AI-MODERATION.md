# AI-Assisted Moderation & Flagging (Cloudflare Workers AI)

**Status:** Draft v1 for review
**Date:** 2026-11-07
**Epic:** 28 (AI-assisted moderation & flagging)
**Related:** existing moderation (api-videos reports → admin-api D1 → admin-web queue), Epic 1 (story 1.3 GDPR),
Epic 26 (Ummah Comments widget), Epic 27 (entitlements), native Epics 17/18 (live chat, Studio)

---

## 1. Goals & principles

1. **Assist humans, don't replace them.** AI *flags, scores and prioritises*; people decide. The only
   automatic removals are severe, high-precision cases (known-CSAM hash match, obvious spam/scam
   patterns), and every automatic action is reviewable and appealable.
2. **Arabic and English parity.** Detection quality must be measured and acceptable in **both**
   languages before anything is enforced.
3. **Islamic context awareness.** Quoting Qur'an verses about battles, discussing fiqh of
   marriage/purity, or historical accounts must not be flagged as violence or sexual content.
   Conversely, catch harms specific to our community (sectarian takfir/hate, fake charity scams,
   impersonation of scholars).
4. **Privacy.** Content is processed inside Cloudflare (our existing processor); no third-party AI
   vendors; models are not trained on our data; signals have a retention limit.
5. **Cost-capped.** Fits inside the platform budget (see section 9). Workers AI includes 10,000 free
   neurons per day.
6. **Fail safe.** If AI is slow or down, content follows normal rules: post then review async, or
   hold for review for low-trust accounts. It never silently disappears.

---

## 2. What gets checked

| Surface | Timing | Checks |
|---|---|---|
| Video comments, community posts & comments, widget discussions (Epic 26) | **Pre-publish (sync, ≤ 800 ms budget)** + async deep check | Text safety, spam/scam, links, near-duplicates |
| Live chat (Epic 17) | Sync, ≤ 300 ms (fast path only) | Keyword/regex + trust score; AI async with retroactive hide |
| Video uploads | Async after processing | Title/description/tags text; thumbnail & sampled frames (vision); **audio transcript** (speech-to-text) then text safety |
| Thumbnails, avatars, banners, post images | Async on upload | Vision safety; CSAM hash scanning |
| Channel / profile names & bios | Sync on save | Text safety, impersonation of verified scholars/institutions |
| User reports | On report | AI summary + category suggestion to triage the human queue |

---

## 3. Policy categories

The **base** categories come from Llama Guard 3 (violent crimes, non-violent crimes, sex-related crimes,
child sexual exploitation, defamation, specialised advice, privacy, IP, indiscriminate weapons, hate,
self-harm, sexual content, elections, code-interpreter abuse). Platform **extensions** are evaluated
with a custom policy prompt (section 4):

| Extension | Example | Default action |
|---|---|---|
| `sectarian_hate` | Takfir or incitement against a sect/group, dehumanising language | Hold for review |
| `violent_extremism` | Praise/recruitment for terrorist groups, calls to violence (distinguished from scripture/history discussion) | Hold + escalate |
| `charity_scam` | Fake zakat/sadaqah/fundraising, crypto doubling, "send to this account" | Hold; auto-hide if high confidence + low trust |
| `impersonation` | Posing as a verified scholar/institution | Hold |
| `harassment` | Targeted insults, doxxing | Hold |
| `spam` | Repeated links, SEO spam, promotion unrelated to content | Auto-hide (reversible) |
| `sexual` | Explicit content (not fiqh discussion) | Hold (auto-hide on images) |
| `misinfo_health` | Dangerous medical claims (e.g. "stop insulin, use only…") | Flag for review |
| `religious_authenticity` (opt-in) | Fabricated hadith attribution, flagged for **scholar review**, never auto-actioned | Flag only |

Admins can tune thresholds and actions per category, per surface and per language (section 7).

---

## 4. Models & pipeline (Workers AI)

| Purpose | Model (Workers AI) | Notes |
|---|---|---|
| Text safety (base categories) | `@cf/meta/llama-guard-3-8b` | **Arabic is not among its listed languages.** Used on English text and on English translations of Arabic text |
| Arabic → English for safety | `@cf/google/gemma-4-26b-a4b-it` (m2m100 retired 2026-11-13: unusable for Arabic, #813; owner decision VR3) | Translate, then Llama Guard; keep the original for reviewers |
| Platform extensions + Arabic native pass | A multilingual instruction model with JSON output (candidates: `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/qwen/...`, `@cf/mistralai/mistral-small-3.1-24b-instruct`) | Chosen by eval (section 8); prompt contains our policy, few-shot Arabic/English examples and an Islamic-context allow list |
| Images / video frames | `@cf/meta/llama-3.2-11b-vision-instruct` or `llama-4-scout` (vision) | Structured JSON verdict; frames sampled every N seconds + scene changes |
| Speech-to-text | `@cf/openai/whisper-large-v3-turbo` | Transcripts feed text safety; **bonus:** draft captions for creators |
| Near-duplicate & spam clustering | `@cf/baai/bge-m3` embeddings | Detect copy-paste spam waves; similarity to known-bad items |
| Known CSAM | Cloudflare **CSAM Scanning Tool** (fuzzy hashing on cached images) | Free; we still report to NCMEC/regional hotline. **Verify coverage for R2-served images** (open item M4) |

### Pipeline
```
content write (api-videos)
  ├─ fast path (sync): normalise (Arabic diacritics/kashida, homoglyphs), keyword & link rules,
  │    trust score → allow | hold | block
  │    + optional AI quick check (Llama Guard on short text) within budget, else skip
  └─ enqueue → "moderation" queue (Cloudflare Queues)
        processor/moderation consumer:
          language detect → (ar? translate) → Llama Guard
                          → extension classifier (multilingual LLM, JSON)
                          → embeddings (dup/spam clusters)
          media: vision on thumbnails/frames, whisper on audio, then text checks on the transcript
        → moderation_signals (D1) → decision engine (thresholds, trust, surface)
        → action: none | hold | hide | escalate | notify creator/site moderator
        → admin queue (priority = severity × confidence × reach)
```

- All Workers AI calls go through **AI Gateway** (logging, caching of identical inputs, rate limits,
  per-model spend dashboards, fallback model routing).
- Model ids and prompt versions are stored with every signal (reproducibility, audits).

---

## 5. Trust & reach

- **Trust score** per account: age, verified email, prior upheld reports, prior approved content,
  channel verification (scholar badge), Site reputation (widget). Low trust leads to pre-moderation for links
  and first posts; high trust gets a lighter path.
- **Reach weighting:** content on high-traffic videos and live events is prioritised in the queue.

---

## 6. Human review & creator tools

- **Admin moderation queue (admin-web):** new columns and filters for AI category, confidence,
  language, model rationale (short), translation shown next to the original, one-click actions,
  keyboard triage; "AI-suggested" vs "user-reported" sources; bulk actions on spam clusters.
- **Feedback loop:** every human decision is stored as a label (agree/disagree with AI) to measure
  precision/recall and tune thresholds.
- **Appeals:** affected users can appeal any AI-originated action; appeals go to a human.
- **Creator/Site moderation (Studio, Epic 26.5):** creators and site owners see AI flags on their own
  comments/discussions and choose per channel/site: "hold flagged comments" or "show but mark". This
  is the tiered part (section 10).
- **Transparency:** notices say "automated tools may assist moderation" (privacy notice and community
  guidelines, en/ar).

---

## 7. Configuration (admin-web → Moderation → AI)

- Per category × surface × language: threshold, action (none / flag / hold / hide / escalate), enabled.
- Shadow-mode toggle per category (log only).
- Keyword/regex lists (Arabic and Latin, with normalisation), allow-lists (e.g. Qur'anic phrases,
  common religious terms that trip naive filters).
- Model/prompt version selection with staged rollout (percentage) and instant rollback.

---

## 8. Evaluation before enforcement

1. **Golden set:** about 2,000 labelled items (50% Arabic incl. dialects, 50% English), covering every
   category plus hard negatives (scripture quotes, fiqh discussions, historical lectures, nasheed
   lyrics, du'a). Built from synthetic + anonymised real data with consent.
2. Compare candidate pipelines (Llama Guard on translation vs a native multilingual LLM vs both).
   Target per category/language: precision ≥ 0.90 for auto-actions, recall ≥ 0.80 for flags.
3. **Shadow mode 2–4 weeks** on QA, then production, before any hold/hide action is enabled.
4. Ongoing: weekly metrics (agreement rate, false-positive rate by language), drift alerts, and
   re-evaluation on any model/prompt change (CI job on the golden set).

---

## 9. Cost estimate (Workers AI list prices)

Assumptions at "millions of viewers" scale: 1M comments/posts per month (avg ~120 tokens), 50% Arabic;
500 new videos/month averaging 30 min; thumbnails + 20 sampled frames per video.

| Item | Volume | Price | ~Monthly |
|---|---|---|---|
| Llama Guard 3 (input) | ~150M tokens (incl. prompt) | $0.484 / M | ~$73 |
| Translation ar→en | ~60M in + 60M out tokens | $0.342 / M each | ~$41 |
| Extension classifier (multilingual LLM) | 1M calls × ~400 in / 40 out tokens | ~$0.05–0.30 / M in, ~$0.4–0.7 / M out (model-dependent) | ~$40–150 |
| Whisper transcripts | 15,000 min | $0.0005 / min | ~$8 |
| Vision (frames/thumbnails) | ~11k images | ~$0.05 / M in, $0.68 / M out | ~$5–15 |
| Embeddings | ~150M tokens | $0.012 / M | ~$2 |
| CSAM Scanning Tool | — | free | $0 |
| **Total** | | | **~$170–290 / month** |

Free allocation (10k neurons/day) covers QA and early production. Optimisations: skip the AI pass for
high-trust users' short comments, cache identical texts (AI Gateway), run extensions only when the
fast path or Llama Guard is uncertain. The **backfill** of existing videos (transcripts + frames) is a
one-off of roughly $75 per 150k minutes.

This is a **separate line** from video delivery; together they must still respect the overall
infrastructure budget.

---

## 10. Tiers (Epic 27 entitlements)

Platform safety (base AI checks, CSAM, spam) is **always on for everyone** and never tiered.
Creator/site-facing controls are tiered (seed values, admin-editable):

| Entitlement | Free | Plus | Pro | Institution |
|---|---|---|---|---|
| `moderation.ai.creatorFlags` (see AI flags on own content) | ✅ | ✅ | ✅ | ✅ |
| `moderation.ai.autoHold` (hold flagged comments on own channel/site) | — | ✅ | ✅ | ✅ |
| `moderation.ai.customRules` (own keyword lists & thresholds) | — | — | ✅ | ✅ |
| `moderation.ai.widgetGuestPosts` (AI pre-check for guest posts, Epic 26) | — | — | ✅ | ✅ |
| `moderation.ai.reports` (moderation analytics & export) | — | basic | ✅ | ✅ |
| `captions.ai.drafts` (Whisper draft captions for creators) | 60 min/mo | 600 | 3,000 | custom |

---

## 11. Data & privacy

- `moderation_signals` (D1, admin-owned): subject type/id, surface, language, categories with
  scores, model + prompt version, decision, reviewer decision, timestamps. **No full content copies**:
  references only. Translations for review are cached up to 30 days.
- Retention: signals 12 months (appeals/audits), then aggregated; erased with the subject under
  story 1.3 data deletion.
- DPIA update: automated processing, legal basis (legitimate interest / platform safety), no solely
  automated decisions with legal effect (GDPR Art. 22): humans review account-level actions.

---

## 12. Epic 28 stories

| # | Story | Priority |
|---|---|---|
| 28.1 | Moderation queue + `moderation_signals` schema + decision engine (thresholds, actions, audit) | P0 |
| 28.2 | Fast path: Arabic/Latin normalisation, keyword/link rules, trust score, sync hold/allow | P0 |
| 28.3 | Text pipeline: language detect → translate → Llama Guard + extension classifier via AI Gateway | P0 |
| 28.4 | Golden evaluation set + CI eval job + shadow mode | P0 |
| 28.5 | Admin queue UI: AI signals, translations, rationale, bulk/cluster actions, feedback labels | P0 |
| 28.6 | Media pipeline: thumbnails/images vision checks; video frame sampling | P1 |
| 28.7 | Whisper transcripts, transcript safety, draft captions for creators | P1 |
| 28.8 | Spam clustering with bge-m3 embeddings + bulk takedown | P1 |
| 28.9 | CSAM Scanning Tool enablement + NCMEC/regional reporting runbook | P0 |
| 28.10 | Creator & Site moderation controls (Studio, Epic 26.5) with entitlements | P1 |
| 28.11 | Appeals flow + user notices (en/ar) | P1 |
| 28.12 | Live chat fast path + async retro-hide (with Epic 17) | P2 |
| 28.13 | Admin config: per-category thresholds/actions/languages, model & prompt versioning, rollout | P1 |
| 28.14 | Report triage assistant: AI summary + suggested category for user reports | P2 |

**Phasing:** (A) 28.1–28.5 + 28.9 in shadow mode, about 4 weeks; (B) enable holds for spam/scam/sexual in
both languages once eval targets are met; (C) media, transcripts, creator controls, appeals, about 4 weeks;
(D) live chat and triage assistant.

---

## 13. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| M1 | Extension classifier model | Pick by golden-set eval (Arabic precision first) |
| M2 | Auto-hide scope | Only spam/scam (high confidence + low trust) and CSAM matches; everything else is hold-for-review |
| M3 | `religious_authenticity` flags | Opt-in, scholar-review queue only; never auto-action |
| M4 | CSAM coverage for R2-served media | Confirm with Cloudflare whether the CSAM tool covers R2 custom-domain traffic; otherwise add perceptual hashing on upload |
| M5 | Reviewer staffing & SLAs | Define queue SLAs per severity (e.g. 1 h for violent extremism/CSAM, 24 h for the rest) |
| M6 | Transparency reporting | Publish periodic moderation stats (en/ar) |

## Sources
- Workers AI models: https://developers.cloudflare.com/workers-ai/models/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- AI Gateway Guardrails (Llama Guard, language coverage, latency): https://developers.cloudflare.com/ai-gateway/features/guardrails/usage-considerations/ and https://blog.cloudflare.com/guardrails-in-ai-gateway/
- CSAM Scanning Tool: https://blog.cloudflare.com/a-simpler-path-to-a-safer-internet-an-update-to-our-csam-scanning-tool/ and https://developers.cloudflare.com/changelog/2025-02-04-easier-onboarding-for-csam-scanning-tool
