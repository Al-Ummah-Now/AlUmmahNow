# Embeds & sharing: implementation plan (v1)

Spec: `docs/specs/EMBEDS-COMMENTS-TIERS.md` (Epics 25–27). Contract for integrators: [`README.md`](./README.md).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Embeds are served by the existing web app at `{videos host}/embed/...` (`/embed/v/{id}`, `/embed/p/{id}`), not yet on `embed.alummahnow.net` (spec E1). | A new host needs a custom domain on the web worker in every environment; the paths are spec-shaped so the move is a host alias. Cookie isolation, the main reason for E1, is handled by the embed reading no cookies and fetching anonymously. Queued. |
| D2 | Embed pages render inside the root layout's **minimal shell** (no navigation, auth, websocket, consent banner, notification center), selected by a request header the middleware sets for `/embed/*`. | Same Next app and same player component, without moving every route into a route group. The root layout skips `authenticated()` for embeds, so no session is read. |
| D3 | The embed's language comes from `?lang=` through a locale override context that `useLanguage()` honours, instead of the URL path. | Embed URLs have no locale segment; every player sub-component uses `useLanguage()`. |
| D4 | Facade by default: poster + play button; the player mounts on press (or at once with `autoplay=1`, muted). | Spec 25.4 privacy-enhanced default (no analytics before play) and page weight. The view counts on player `ready`, so a never-played embed counts nothing and a played one counts once. |
| D5 | Framing: `frame-ancestors *` and no `X-Frame-Options` on `/embed/*` only; every other route keeps `'none'` / `DENY`. | Spec default "embedding allowed anywhere". Per-video allowlists are Studio work (25.6), queued. |
| D6 | oEmbed is a Next route handler at `{videos host}/oembed`, public CORS. | Spec 25.3 puts it on the videos host; the CMS can call it from the browser. |
| D7 | Analytics: the embed's `VideoAnalytics` batch carries `context: { source: 'embed', embedOrigin }`; the Next route forwards it to `POST /api/videos/:id/view` (`source`, `embedOrigin`); the processor adds per-day `sources` / `embedOrigins` maps (bounded) to the rollups. | Reuses the counted-view path (docs/analytics/README.md), no new message type, no double count (the fetch telemetry is not a counted view). First slice of #237's source dimension. |
| D8 | The view endpoint refuses to count deleted / hidden videos (it already refused private ones). | An embed of a removed video must not count. |
| D9 | `postMessage` API: one partner origin (param checked against `ancestorOrigins`, else `ancestorOrigins[0]`, else referrer origin), never `*`. | Spec 25.5 strict origin checks both ways. |
| D10 | Epic 26 ships read-only: `/embed/comments/{videoId}` + `widget.js` (`<alummah-discussion video>`), shared thread only. | Posting needs a public OAuth client (registered in AlUmmahNowAuth via migration), Sites, moderation and anti-abuse; that is the bulk of the epic and is queued. Read-only needs no auth changes. |
| D11 | No signed-in embeds in v1. | Third-party cookies are blocked or partitioned; the spec's design (first-party popup + token) needs the auth client work above. Queued. |
| D12 | Entitlements (Epic 27) are not consulted: everything in v1 is on every plan's Free tier (`embed.enabled`, `share.*`). | Epic 27 is not built; v1 uses no gated key (`embed.customColor`, `hideBranding`, `privateVideos`, domain allowlists are all deferred). |

## Work items

1. **Docs** (this file, `README.md` contract).
2. **Web: embed route**: `app/embed/v/[id]`, `app/embed/p/[id]`, `app/embed/comments/[id]`; server components fetch anonymously from the API; `EmbedPlayer` client component (facade, `VideoPlayerWithChapters`, start/end/loop/autoplay-muted, title bar, "Watch on Al Ummah Now"); unavailable frame; playlist list + auto-advance.
3. **Web: params & postMessage**: `lib/embed/params.ts` (parse/validate), `lib/embed/messaging.ts` (partner origin, events, commands), `lib/embed/snippets.ts` (iframe snippets, URLs).
4. **Web: headers**: middleware branch for `/embed/*`, `/oembed`, `/embed/widget.js`; `buildContentSecurityPolicy({ frameAncestors })`; no `X-Frame-Options` on embeds.
5. **Web: oEmbed**: `app/oembed/route.ts` with `lib/embed/oembed.ts` (URL recognition, sizing, response).
6. **Web: watch page**: `?t=` start time; Share dialog (copy link, at current time, embed code with sizes, social targets, native share); server `generateMetadata` (OG / Twitter player / hreflang / oEmbed link).
7. **Web: analytics context**: `VideoAnalytics` `context`, `/api/analytics/video` forwards `source` / `embedOrigin`.
8. **API**: view endpoint accepts `source` (`watch` | `embed`) and `embedOrigin` (validated origin), refuses removed videos; CORS origins for www / CMS (prod, stage, QA) in wrangler configs and `scripts/release/apps.ts`.
9. **Processor**: rollup `sources` / `embedOrigins` maps (top 50 origins per day, rest under `other`).
10. **Widget**: `public/embed/widget.js` custom element with auto-resize.
11. **Tests**: unit (params, messaging, snippets, oEmbed, CSP, middleware, analytics route, view endpoint, rollup); E2E against QA (`e2e/70-embeds.spec.ts`): cross-origin iframe plays (branded Chrome), private shows unavailable, oEmbed JSON valid, share dialog snippet, `lang=ar` RTL, headers.

## Data

No migration: `source` / `embedOrigin` are optional on new queue payloads; the rollup maps are optional on existing
documents (absent = no breakdown recorded). Old documents keep working; a unit test reads one without the maps.

## Deferred (GitHub issues, label `queue`)

- `embed.alummahnow.net` host (E1).
- Live embeds `/embed/live/{id}`; embed params `captions`, `chapters`, `speed`, `theme`, `color`, `branding`,
  `related`, `controls=0`, `comments=1`; end screen (25.7).
- `@alummahnow/embed` npm/CDN wrapper with types (25.5).
- Creator embed controls in Studio: embedding on/off, domain allowlists, signed embed tokens, private embeds (25.6).
- Studio embed analytics by domain/page (25.8) on top of the new rollup maps; per-Site metering (25.9).
- Short links, QR code, chapter links, sharing playlists/channels/posts (25.1); JSON-LD `VideoObject` (25.2).
- Signed-in embeds (popup sign-in).
- Epic 26 beyond read-only: Sites and verification, site keys, posting with a registered public OAuth client
  (AlUmmahNowAuth migration), page threads and `site` scope, moderation, anti-abuse, SEO snapshot, export,
  webhooks, Studio surfaces, live updates.
- Epic 27 plans & entitlements framework.
