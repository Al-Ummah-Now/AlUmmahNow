# Pre-publication video review: build contract

**Status:** building (owner decisions VR1–VR16 taken 2026-11-13)
**Wiki:** `epics/AUN-VIDEO-REVIEW-pre-publication-review.md` (AlUmmahNowWiki) has the spec, decisions and costs.
**Shared contract:** `packages/shared-types/src/video-review.ts`. This page says who does what with it.

## 1. Rules that never bend

1. **Production only.** The env gate `VIDEO_REVIEW_ALLOWED` is `"true"` only in the production wrangler configs of api-videos, processor and admin-api. `check:config` pins production to `"true"` and stage to `"false"`; QA sets `"false"`. `effectiveReviewMode()` returns `off` anywhere else, whatever the settings say. QA, stage, previews and the local stack never run a check and never hold a video.
2. **Open-weight models only.** Workers AI hosts them. Model ids live in the settings (`models.*`) and must match `@cf/<org>/<model>`.
3. **No real AI call in any test or CI run.** The processor's `ModerationProvider` has two adapters: `WorkersAiModerationProvider` and `FixtureModerationProvider`. A loud guard throws if the Workers AI adapter is constructed while `NODE_ENV=test`, `CI=true` or `E2E_ENV` is set. Tests and the local stack use fixtures: `clean`, `nsfw_frame@42000`, `explicit_ar_transcript`, `high_risk_metadata`, `provider_down` and `slow`.
4. **Fail safe.** If a check errors after its retries, the budget stops, extraction fails or a setting can't be read, the video is held for a person (or, for unreadable settings, review is off). An unchecked video is never published in an enforce mode.
5. **NSFW always holds** (VR2), trusted channels included. Escalations (minors with any sexual score, violent extremism) go to senior reviewers only.
6. **Single writer.** A video's `review` field is written only by api-videos: the upload gate (`lib/review/gate.ts`) and `/internal/review/*`. Review rows (`content_reviews`, `content_review_findings` in reports D1, migration 0024) are written by the processor (the automated check) and admin-api (people).

## 2. Lifecycle

```
upload complete ──(gate: enforce* → review.status=checking | trusted → post_review)──▶ processing
transcode job (apps/media) ── frames + audio → MEDIA_PRIVATE review/<id>/<rev>/manifest.json
            │ job "ready" event (api-videos /internal/media) carries review media keys
            ▼
api-videos queues VideoReviewScan (MODERATION_QUEUE) ──▶ processor review consumer
            │ provider checks → findings → routeReview() → content_reviews row (+ findings)
            ▼
processor → api-videos POST /internal/review/:videoId/outcome
            ├─ approve → review.status=approved → publishedAt + subscriber announce (if released)
            └─ hold    → review.status=in_review → reviewer alert (in-app, websocket, push)
reviewer (admin-web or native) → admin-api decide → api-videos POST /internal/review/:videoId/decision
            ├─ approve → approved → publish/announce, creator notice
            └─ reject  → rejected (private to owner) → creator notice with reason; appeal once
```

- **Shadow:** the gate writes nothing. The scan still runs and records a `content_reviews` row with `status='shadow'` and the `route` it would have taken. The video never changes.
- **Metadata edit** of a reviewed video: text-only scan (`trigger: 'metadata_edit'`). A hold on an approved video pulls it back only for an NSFW or escalation hit.
- **Resubmit** after a rejection: creator edits, then `POST /api/videos/:id/review/resubmit`, which starts a new review (`trigger: 'resubmit'`, new reviewId).
- **Live:** never pre-reviewed. When the VOD is ready it is scanned post-hoc (`trigger: 'live_vod'`, `timing: 'post'`); an NSFW or escalation hit pulls the VOD back.
  - **How (#1295).** Self-hosted finalize and the Bunny VOD poll call one "recording ready" hook (`lib/live/vod-ready.ts`), which starts a `post_review` review on the `livestream:{id}` record (`review`, `reviewSessionId`; shadow mode: `reviewShadow` only). api-videos sends a `LiveReviewJobMessage` on the transcode queue with the recording's playlist (Bunny: signed). The media worker's DO `live:<streamId>` gives the container read-only `vod.internal` (only under that recording's directory) and `review.internal`. The container's `POST /review` reads one variant of the master (the smallest at least 360 px tall) and extracts frames and audio under `review/<streamId>/<rev>/`. The media worker then reports to `POST /internal/review/livestream/:id/media`, and api-videos queues the scan (`subject: 'livestream'`). An extraction that gives up still reports, so the check runs on the title and thumbnail (partial).
  - The processor writes a `content_reviews` row with `subject_type = 'livestream'` and posts to `/internal/review/livestream/:id/outcome`. The state machine is the video one (`outcomeTransition` / `decisionTransition` in `lib/review/apply.ts`). admin-api sends decisions and undo to `/internal/review/livestream/:id/decision`. The review page reads the recording from `GET /internal/review/livestream/:id` (signed playlist) and plays it, and retention purges its review media like a video's.
  - **Who sees it.** An ended stream whose review is `in_review`, `appealed` or `rejected` reaches its owner only: the stream page and state return 404 to everyone else, and the live list leaves it out. `post_review` and `approved` recordings play for everyone. The hold is tied to a session really going live, never to `status` or a provisioned session (both are the owner's to change): when the current session goes live (`markStreamLive`: first segment or Bunny publishing), `liveAgainSessionId` ends the hold for that session, since live is never pre-reviewed. A held recording's URL stays owner-only either way. Other viewers never get `review`, the shadow marker or `reviewSessionId`. The owner gets the same "approved" / "not approved" notices as for a video, linking to Studio → Live.
- **Other entry points** that create a video ready to play (imports, the Tools importer, admin restores of never-reviewed uploads) call the same gate before the first `ready` write.

## 3. api-videos (owns video state and settings)

| What | Where |
|---|---|
| Gate at upload complete | `lib/review/gate.ts`, `lib/uploads/lifecycle.ts` (done in the foundation PR) |
| Settings read | `readVideoReviewSettings(env.global_settings)`, 30 s cache |
| Queue the scan when the transcode is ready (or at once with no manifest when R2 delivery is off or the job failed: `partial`) | `lib/media/r2-delivery.ts` job-event handler → `lib/review/scan.ts` |
| `POST /internal/review/:videoId/outcome` (processor, X-API-Key) | apply `ReviewOutcomeRequest`: CAS update of `review`; approve → `markPublished` + `announceNewVideo` + search sync + creator notice; hold → `in_review` with `holdCause` |
| `POST /internal/review/:videoId/decision` (admin-api, X-API-Key) | apply `ReviewDecisionRequest`, including undo within `REVIEW_UNDO_MINUTES` |
| `POST /api/videos/:id/review/appeal` (owner) | once per rejection (`appealUsed`), status → `appealed`. Admin-api assigns a reviewer other than the one who decided (VR10) |
| `POST /api/videos/:id/review/resubmit` (owner) | rejected → checking with a new review |
| Owner-facing fields | the owner and members with `video.view_private` get `review.{status, etaAt, reasonCode, decidedAt, appealUsed}` plus `reviewQueueMinutes` (live queue time, from admin-api stats, cached 1 min). Everyone else never gets `review`. `holdCause` is admins only |
| Scheduled publish (VR8) | the scheduler still releases at the time; the video stays hidden until approved; on approval `publishedAt` and the announcement happen then, and the creator is told |
| Caption draft (VR11) | the processor stores the transcript as a review artifact; `POST /api/videos/:id/review/transcript/claim` copies it into the captions draft store (AUN-CAPTIONS), after which it is the creator's caption and survives the review purge. Quran spans follow the captions rules (references, never ASR text) |
| Channel trust | `channel.reviewTrusted` (admin-api sets it; audited) |
| Studio | `studio-status.ts` gets `in_review` (checking / in_review / appealed) and `rejected`; badge text "In review", "Usually within 5 minutes" (checking) / "A reviewer will check it · about N min" (in_review) / "Not approved: <reason>" (rejected) with Appeal and Edit and resubmit. en + ar (`مرئي` wording rule) |

## 4. processor (runs the checks)

- **Consumer:** `MessageType.VideoReviewScan` on the moderation queue, in its own module `src/review/`.
- **Pipeline:** `manifest` → frames stage 1 (`models.frames`, 4 images per call, typed questions: sexual none/suggestive/explicit, gore, disturbing, minor_present) → stage 2 (`models.imageReview`) on the thumbnail plus frames scoring ≥ `nsfwScreen` → Whisper (`models.transcribe`, VAD off, language explicit, hallucination filter) → text: Llama Guard (`models.textGuard`, English) and Gemma 4 (`models.textPolicy`, Arabic native and the platform categories, explicit language) → Quran matcher hook (references only) → `routeReview()`.
- **Writes:** one `content_reviews` row and only the flagged findings. Costs go to the existing `ai_usage_daily` with `feature='video_review'`. Every row records model ids and the prompt version.
- **Budget:** `settings.dailyBudgetUsd`, reserved before the calls (the Epic 28 pattern). At the stop, the review routes with `budgetStopped` (held for a person).
- **Retries:** 3 with backoff, then `checkFailed`. A partial check (no manifest) runs metadata and thumbnail only and holds as `check_failed` in `enforce` (NSFW must never pass unchecked frames).
- **Calls** api-videos `/internal/review/:videoId/outcome` through a new `VIDEOS` service binding (X-API-Key = INTERNAL_API_KEY). Shadow records only.
- **Alerts:** on a hold, a `review_needed` notification to every reviewer (in-app and push through the existing notifications pipeline) and a websocket broadcast on `admin:review`. Escalations go to senior reviewers only.
- **Retention:** media under `review/` and finding text are purged by the admin-api cron when `media_purge_after` passes.

## 5. media transcoder (extracts review media)

- **In the existing transcode pass,** when the job message has `review: { rev, frameIntervalSeconds, sceneThreshold, maxFrames }`:
  - frames are `fps=1/interval` plus `select='gt(scene,T)'` at 512 px JPEG, with perceptual-hash dedupe that always keeps scene cuts
  - 16 kHz mono chunks of 10 minutes or less
  - everything goes to `MEDIA_PRIVATE review/<videoId>/<rev>/`, with `manifest.json` (`ReviewMediaManifest`) written last
- **Over the cap:** the interval widens and `capped: true` is set.
- **Event:** the job's `ready` event carries `reviewManifestKey`.

## 6. admin-api (people; web and native clients)

JSON only, cursor paging, the same auth as the other admin routes. It is built for the native admin app.

| Route | Does |
|---|---|
| `GET /api/review/queue?status=action_needed\|history&cursor=&escalated=` | the queue: escalations first for seniors, then by SLA deadline |
| `GET /api/review/:id` | detail: subject summary, findings, frame strip (signed short-lived URLs from MEDIA_PRIVATE through an admin-api media route), transcript spans, metadata, prior decisions, appeal |
| `POST /api/review/:id/reveal` | audited reveal of a blurred NSFW item (moderation_actions `reveal`) |
| `POST /api/review/:id/decision` | approve or reject (`reasonCode`, `note`), or escalate; undo within 10 minutes. Calls api-videos `/internal/review/:videoId/decision` |
| `POST /api/review/:id/claim` | assign to me |
| `GET`/`PUT /api/review/settings` | the settings (super admin; audited `config_change`) |
| `GET /api/review/stats` | queue size, median and live queue time, today's cost, shadow agreement |
| `POST /api/review/devices` | register a reviewer's push device (native), or reuse the existing push registration |

- **Roles:** `content_reviewer` (reviews `status in (in_review, appealed)`, never escalations) and `senior_reviewer` (everything, including minors and escalations, and appeals of their own team). The owner is the first senior reviewer (VR7).
- **Retention cron:** purges review media and finding text after `media_purge_after`; aggregates rows older than 12 months.

## 7. admin-web

The **Videos in review** queue sits under Moderation, with the Action needed and History pattern.

**Review screen:**
- a player at 1× to 3× speed, with timeline markers at flagged timestamps (key `N` jumps to the next)
- a frame strip with flagged frames outlined
- the transcript, with flagged spans, click-to-seek, RTL Arabic and Quran reference chips
- the metadata, with flagged words

**NSFW handling:** thumbnails and frames are blurred by default and revealed one at a time with a button, and the player starts blurred on NSFW items.

**Actions:** approve, reject with a reason, escalate, and undo. The settings page edits every threshold, the ETA and the budget.

Everything is keyboard accessible and in en and ar.

## 8. Images (VR16)

- **Community post with images:** the post is created held (`reviewHold: 'checking'`) while each image is checked with the frames pipeline (stage 1 then stage 2, `subject_type='post'`). If clean, the post is published. An NSFW hit holds the **whole post** for a person.
- **Avatar, banner or profile picture:** there is no post to hold. The new image is served only once it is clean; until then, and on a hit, everyone else sees the default tile. The owner sees their own image with a "being checked" or "not approved" notice.
- Mode off or outside production: nothing changes.

## 9. Rollout

The code ships with mode `off`. After a production release containing every part, an admin sets `shadow`. After about 2 weeks the shadow report is reviewed (hold rate, agreement, misses, p95 latency, cost per video), then the mode goes to `enforce_nsfw` and later `enforce`. Each switch is instant and reversible. Turning review off leaves held videos held, and admin-api's "Release all" bulk action (with undo) releases them.
