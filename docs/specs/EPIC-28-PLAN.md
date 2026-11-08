# Epic 28 plan: AI-assisted moderation (Workers AI)

**Spec:** [AI-MODERATION.md](./AI-MODERATION.md) · **Status:** Phase A in progress · **Date:** 2026-11-08

This plan turns the spec into PRs. It covers Phase A (spec §12: stories 28.1, 28.3, 28.4, 28.5, plus
the kill switch, the daily budget cap and usage logging) in detail, and lists the later phases as
GitHub issues labelled `queue`.

## 0. Rules this plan holds to

1. **AI never deletes.** It writes a signal and, at most, *hides* content. Hiding is a status flag
   (`held`), never a removal, and is undone with one click (§5).
2. **Hide only where the spec allows** (spec §3 and decision M2): `spam`, and `charity_scam` with high
   confidence from a low-trust author. Everything else is `flag` (into the review queue) or `none`.
3. **Shadow mode is the default** for every category in every environment. In shadow mode the
   decision engine records what it *would* do (`decision = 'would_hide'`, `'would_flag'`) and takes
   no action. Enforcement is switched on per category by an admin, after the eval targets in §7.
4. **Every AI action is logged** with the model id, the prompt version and the score, in
   `moderation_actions` (the audit log), next to the signal it came from.
5. **Kill switch and budget** checked before every Workers AI call (§4).
6. **No content copies in D1.** Signals reference the subject (type + id). Text travels only in the
   queue message. A short reviewer translation is the one exception (spec §11) and expires after 30 days.
7. **Bilingual.** Every admin-web string has `en` and `ar` keys; the eval set is half Arabic.
8. **Tests never call Workers AI.** The `AI` binding is a mock in every unit test.

## 1. Pipeline

```
api-videos write (comment / post / post comment / video title+description)
  └─ after the R2 write succeeds, in the background:
       MODERATION_QUEUE.send({ type: ModerationScan, subject, surface, authorId, text, ... })
       (a failed send is logged; the content is published as normal: fail safe, spec §1.6)

processor: consumer of "al-ummah-now-moderation[-qa|-stage]"   (own queue: own retries, DLQ, batch size)
  for each message:
    1. kill switch?  (env AI_MODERATION_ENABLED + D1 moderation_config.enabled)   → signal 'skipped:disabled'
    2. budget?       (today's neurons in ai_usage_daily ≥ cap)                    → signal 'skipped:budget'
    3. normalise text (strip diacritics/tatweel, collapse whitespace), detect language (Arabic-script ratio)
    4. ar → @cf/meta/m2m100-1.2b → English            (translation kept 30 days for reviewers)
    5. @cf/meta/llama-guard-3-8b on the English text  → safe | unsafe + S-categories
    6. (if enabled) extension classifier, multilingual LLM, JSON verdict with a 0–1 confidence
       per platform category (spam, charity_scam, sectarian_hate, …), original-language text
    7. decision engine: per category × surface thresholds + mode (shadow | enforce)
    8. write moderation_signals + moderation_actions (audit) + ai_usage_daily (neurons, tokens, calls)
    9. enforce only: flag → review queue (status 'pending'); hide (spam/scam only) → sets `held`
       on the subject (reversible). Automatic hide ships in Phase B, once a category passes the
       eval gate (§7); in Phase A only reviewers hide and restore, through admin-api (§5).
```

Why a separate queue (and not the existing `al-ummah-now-videos` consumer): AI calls take seconds and
can hit rate limits. A separate queue keeps them away from views, likes and notifications, and gives
moderation its own retry count, batch size and DLQ (`al-ummah-now-dlq[-qa|-stage]` is reused).

### What is scanned

| Surface (`surface`) | Subject | Event | Phase |
|---|---|---|---|
| `video_comment` | comment id (parent: video id) | create, edit | A |
| `community_post` | post id | create, update | A |
| `post_comment` | comment id (parent: post id) | create, edit | A |
| `video_metadata` | video id | create, update of title/description/tags | A |
| `profile` / `channel` names & bios | user / channel id | save | C (issue) |
| thumbnails, avatars, banners, post images (vision) | — | upload | C (issue, 28.6) |
| **video frames and audio** (vision + Whisper) | video id | after encoding | C (issue, 28.6/28.7). The spec includes them; they are not in Phase A |
| live chat | — | — | D (issue, 28.12) |

### Models (spec §4)

| Step | Model | Pricing (Workers AI list) → neurons |
|---|---|---|
| Translation ar→en | `@cf/meta/m2m100-1.2b` | $0.342/M in, $0.342/M out → 31,050 neurons/M each |
| Text safety | `@cf/meta/llama-guard-3-8b` | $0.484/M in, $0.030/M out → 44,003 / 2,730 neurons/M |
| Extensions (default, M1 open) | `@cf/meta/llama-4-scout-17b-16e-instruct` | $0.270/M in, $0.850/M out → 24,545 / 77,273 neurons/M |

Neurons are priced at $0.011 per 1,000 (10,000/day free). The processor converts token counts to
neurons with this table (`apps/processor/src/moderation/pricing.ts`). It uses the model's reported
`usage` when present, otherwise an estimate (chars ÷ 4 for Latin, chars ÷ 2 for Arabic).

Llama Guard returns a verdict, not a probability. Its score is recorded as `1.0` (unsafe) or `0.0`
(safe) per category. Graded scores come from the extension classifier, which is why hide decisions
(spam, scam) depend on it.

AI Gateway (spec §4): every `AI.run` call passes `{ gateway: { id } }` when `AI_GATEWAY_ID` is set.
It is unset in Phase A (open question Q2).

## 2. Data (D1 `al-ummah-now-reports[-qa|-stage]`, migrations in `apps/admin-api/migrations`)

`0002_ai_moderation.sql` (append-only, snapshot regenerated):

| Table | Purpose |
|---|---|
| `moderation_signals` | one row per scan: subject type/id, parent id, surface, author id, language, `categories_json` ({category: score}), top category + score, models + prompt version, decision (`none`, `would_flag`, `would_hide`, `flag`, `hide`, `skipped`), skip reason, review status (`pending`, `agreed`, `disagreed`, `n/a`), reviewer id, reviewer decision, translation (expires 30 days), timestamps |
| `moderation_actions` | audit log: every action on a subject by `ai` or a person (`flag`, `hide`, `restore`, `agree`, `disagree`, `config_change`, `appeal_*`), with actor, model, score, reason, signal id |
| `moderation_config` | key/value remote config: `enabled`, `daily_neuron_cap`, `extensions_enabled`, per-category `{mode, threshold, action}` JSON |
| `ai_usage_daily` | per day × model: calls, input tokens, output tokens, neurons, estimated USD. Read by the budget check and by the cost dashboard |
| `moderation_appeals` | appeal per action: user id, message, status (`open`, `upheld`, `overturned`), reviewer, timestamps (Phase C UI; table now so actions can link to it) |

Retention (spec §11): the processor's daily cron clears `translation` after 30 days and deletes
signals (and the AI's audit rows) older than 12 months. User erasure (story 1.3): the existing
`UserDataErased` handler tombstones the author on the user's signals and appeals and drops translations.

## 3. Thresholds and actions (seed config, all `mode: shadow`)

| Category | Source | Threshold | Action when enforced |
|---|---|---|---|
| Llama Guard S1–S14 (violent crimes, hate, sexual, self-harm, …) | Llama Guard | unsafe verdict | `flag` |
| S4 child sexual exploitation | Llama Guard | unsafe verdict | `flag` + escalate (priority 100). Never auto-hidden by text alone; images go through the CSAM tool (28.9) |
| `spam` | extension | ≥ 0.90 | `hide` (reversible) |
| `charity_scam` | extension | ≥ 0.90 **and** low-trust author | `hide` (reversible); otherwise `flag` |
| `sectarian_hate`, `violent_extremism`, `harassment`, `impersonation`, `sexual` | extension | ≥ 0.70 | `flag` (`violent_extremism` escalates) |
| `misinfo_health` | extension | ≥ 0.80 | `flag` |
| `religious_authenticity` | extension, opt-in | ≥ 0.80 | `flag` to scholar review only, never actioned |

The decision engine refuses `hide` for any category other than `spam` and `charity_scam`, whatever
the config says (unit-tested). Queue priority = severity × confidence (reach weighting is Phase C).
"Low trust" in Phase A = account younger than 7 days or no prior approved content; until the trust
score (28.2) exists, the engine treats every author as *not* low trust, so `charity_scam` can only flag.

## 4. Kill switch, budget and usage logging

- **Kill switch:** two levels, both must allow. `AI_MODERATION_ENABLED` env var in the processor's
  wrangler config (`"false"` stops all AI calls at the next deploy), and `moderation_config.enabled`
  in D1, which an Admin flips in admin-web and which takes effect on the next message. **No D1 row
  means off**, so a newly deployed environment (stage, production) makes no AI call until an Admin
  turns it on. Off means no AI call and no row (keeps D1 quiet); the content is unaffected.
- **Daily budget cap:** `AI_MODERATION_DAILY_NEURON_CAP` (env default) overridable by
  `moderation_config.daily_neuron_cap`. Before each message the processor sums today's (UTC)
  neurons in `ai_usage_daily`; at or above the cap it skips with reason `budget` and logs a warning
  once. Defaults: QA 10,000 and stage 10,000 (the free allocation), production 100,000 (~$1.10/day)
  for the shadow period.
- **Usage logging for the cost dashboard** ([cost-monitoring spec](../cost-monitoring/README.md)):
  1. `ai_usage_daily` in D1 is the source of truth (per day × model × env), exposed by admin-api
     `GET /api/moderation/ai/usage?days=30`.
  2. Every call also emits a structured log line `[AI_USAGE] {model, surface, inputTokens,
     outputTokens, neurons, usd}` so Workers Logs queries can sum it.
  3. The cost collector should add a `workers_ai` product (GraphQL `aiInferenceAdaptiveGroups`, by
     model) and reconcile it against `ai_usage_daily`. That collector does not exist yet, so this is
     an issue on the cost-monitoring epic, not code here.

## 5. Human review (admin-web → Moderation → AI)

Roles: **Super Admin, Admin, Moderator** can view the queue and review. Only **Super Admin and
Admin** can change config or use the kill switch.

- **Queue page** (`/moderation/ai`): signals with filters (decision, category, surface, language,
  review status), columns for category, score, language, model, prompt version, time. Detail panel:
  the original text (fetched live from the subject, never from D1), the English translation for
  Arabic items, the per-category scores, the audit trail.
- **Actions:** *Agree* / *Disagree* (feedback label, spec §6), *Hide* (sets `held`), *Restore*
  (clears `held`). Hide and restore go through admin-api, which edits the subject in R2 the same way
  the comment-held feature does. Each writes a `moderation_actions` row with the reviewer's id.
- **Settings page** (`/moderation/ai/settings`): kill switch, daily cap, extensions toggle, and per
  category mode (shadow/enforce), threshold and action. Every change is audited (`config_change`).
- **Usage card:** today's neurons against the cap, last 30 days by model.

## 6. Appeals (story 28.11, Phase C)

1. A hidden comment shows its author a notice, "Hidden by automated moderation. Appeal", in en/ar.
2. The appeal creates `moderation_appeals` (open) and a `moderation_actions` row (`appeal_open`).
3. It appears in the admin queue with an *Appeal* badge. A human upholds it (stays hidden) or
   overturns it (restored, `appeal_overturned`). Either way the author gets a notification (Epic 29
   notifications), en/ar.
4. Nothing becomes permanent until a human has looked at it (GDPR Art. 22, spec §11).

## 7. Evaluation set and enforcement gate (story 28.4)

- `apps/processor/eval/golden.jsonl`: a seed set of synthetic items, half Arabic (MSA + Gulf,
  Levantine, Egyptian dialects), half English, labelled with the expected category or `safe`.
  Hard negatives: Qur'an verses about battle, fiqh of marriage and purity, historical lectures,
  nasheed lyrics, du'a. No real users' content. It grows to ~2,000 items (spec §8) as reviewers label
  real signals in the queue (labels only, never copies of content).
- `pnpm --filter @al-ummah/processor eval` runs the pipeline over the set against **QA's** Workers AI
  (needs `CLOUDFLARE_ACCOUNT_ID` and a token) and prints precision and recall per category ×
  language. It is not in CI (it costs neurons); CI runs the same set through the **mocked** pipeline
  to test parsing and decisions.
- **Gate:** a category may be switched to `enforce` only when, in both languages, precision ≥ 0.90
  (for `hide`) and recall ≥ 0.80 (for `flag`), and after ≥ 2 weeks of shadow mode on QA and
  production with a reviewer agreement rate ≥ 90%.

## 8. Cost estimate and cap

Per item (avg 120 tokens of text):

| Step | Tokens | Neurons |
|---|---|---|
| Llama Guard (text + ~330-token policy template) | ~450 in, ~5 out | ~20 |
| Translation (Arabic only, 50%) | 120 in, 120 out | ~7.5 × 0.5 = ~3.7 |
| Extension classifier (when enabled; ~400 in, ~40 out) | | ~13 |
| **Total** | | **~24 without extensions, ~37 with** |

| Volume | Neurons/day | Cost/day | Cost/month |
|---|---|---|---|
| QA (seeded tests, < 300 items/day) | < 10,000 | $0 (free) | $0 |
| Production today (~2k items/day) | ~74k | ~$0.70 | ~$21 |
| Spec scale (1M items/month ≈ 33k/day) | ~1.2M | ~$13.5 | ~$400 (≈ spec's $170–290 once extensions run only on uncertain items) |

**Cap:** production starts at **100,000 neurons/day (~$1.10/day, ≤ $33/month)**. When the cap is
reached, remaining items that day are skipped (logged, content unaffected) and the next day resumes.
Raise the cap in admin-web as volume grows; the usage card shows when it binds.

## 9. Test plan

| Layer | Tests |
|---|---|
| Processor unit (jest, node:sqlite D1) | normaliser and language detection (Arabic, mixed, Latin); Llama Guard response parsing (object and string forms); extension JSON parsing (fenced, invalid → ignored); decision engine (shadow vs enforce, thresholds, **hide refused outside spam/scam**, S4 escalation); kill switch (env and D1); budget cap (skips at cap, counts neurons); usage rows; signal + audit rows; AI error → `skipped:error`, message acked, content untouched |
| Golden set (mocked) | every golden item goes through the mocked pipeline; parsers and decision engine match labels for the mocked verdicts |
| api-videos | create/edit of comment, post, post comment, video sends one `ModerationScan` with the right subject; a failing queue send does not fail the request |
| admin-api | RBAC (Moderator can review but not change config; non-admin 403); list filters; agree/disagree; hide/restore write R2 + audit; config validation refuses `hide` outside spam/scam |
| admin-web | i18n keys present in en and ar (existing key-parity test); page renders with mocked API |
| QA (manual, after merge) | seed synthetic comments with a QA test account (en + ar, safe + unsafe + hard negatives); confirm signals in the queue with model + score; flip kill switch → `skipped:disabled`; set cap to 1 → `skipped:budget`; agree/disagree and hide/restore round-trip; usage card shows neurons |

## 10. PRs

| # | PR | Contents |
|---|---|---|
| 1 | docs | this plan |
| 2 | schema + types | `0002_ai_moderation.sql` + snapshot; shared types (`MessageType.ModerationScan`, payload, categories, decisions) |
| 3 | processor | moderation consumer, AI client with kill switch/budget/usage, translate + Llama Guard + extension classifier, decision engine, audit; `AI` binding + moderation queue consumer in QA/stage/prod configs and `scripts/release/apps.ts`; golden seed set + mocked eval test |
| 4 | api-videos | `MODERATION_QUEUE` producer + `ModerationScan` sends on comment/post/video writes |
| 5 | admin-api | `/api/moderation/ai/*`: signals list/get, review, hide/restore, config, usage |
| 6 | admin-web | AI queue page + settings + usage card (en/ar) |

## 11. Later phases (GitHub issues, label `queue`)

28.2 fast path + trust score · 28.6 vision on images and video frames · 28.7 Whisper transcripts and
draft captions · 28.8 bge-m3 spam clustering · 28.9 CSAM Scanning Tool + reporting runbook · 28.10
creator/site controls with entitlements · 28.11 appeals UI and notices · 28.12 live chat · 28.13
staged model/prompt rollout · 28.14 report triage assistant · `workers_ai` product in the cost collector · AI Gateway.

## 12. Open questions

- **Q1 (M1):** extension classifier model. Default `llama-4-scout-17b-16e-instruct` until the
  golden-set eval picks one.
- **Q2:** create an AI Gateway (`al-ummah-moderation`) per environment now, or after the shadow period?
- **Q3 (M5):** reviewer staffing and SLAs; the queue sorts by priority, but nobody is on call for it yet.
- **Q4:** the production cap of 100k neurons/day: acceptable?
- **Q5 (M4):** CSAM tool coverage for Bunny/R2-served images.
