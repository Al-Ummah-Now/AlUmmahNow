# short-links

Short share links on **alummahnow.link** (wiki: [AUN-SHORT-LINKS](https://github.com/Al-Ummah-Now/AlUmmahNowWiki/blob/main/epics/AUN-SHORT-LINKS-short-share-links.md)).
A short link **redirects** (301) to the real page; Open Graph tags and canonical URLs stay on the real
pages, and nothing on this host is indexed.

| Link | Goes to |
|---|---|
| `/v/<videoId>` | the watch page (`/shorts/<id>` for a Short once `SHORTS_PATH` is `shorts`) |
| `/s/<videoId>` | the Short |
| `/@<handle>` | the channel by handle |
| `/c/<channelId>` | the channel |
| `/p/<postId>` | the post on its channel's Community tab (`?tab=community&post=<id>#post-<id>`) |
| `/l/<playlistId>` | the playlist |
| `/` | the www home |

- **Language:** `?lang=ar` or `?lang=en` picks the page's language; without it the site's own default
  applies (the videos site: the viewer's saved choice, else English). Accept-Language is never read.
  Share buttons on Arabic pages add `?lang=ar`.
- **Kept parameters:** `t`, `list`, `index` and `utm_*`. Anything else is dropped.
- **Not found:** unknown, private and deleted ids answer a bilingual 404 page (noindex) that names
  nothing. Each id is looked up through the public videos API as an anonymous visitor
  (`/api/videos/:id`, `/api/channels/:id`, `/api/channels/by-handle/:handle`, `/api/playlists/:id`,
  `/api/community/posts/:postId`), cached at the edge for 10 minutes (not found: 1 minute). If the API
  is down, a video, channel or playlist link still goes to its page (302, not cached); a post answers 503.
- **Search engines:** every response has `X-Robots-Tag: noindex, nofollow`; `robots.txt` refuses all
  crawlers except the link previewers that read robots.txt before building a card (X, LinkedIn, Slack,
  Telegram, Discord, WhatsApp, Facebook, Pinterest).
- **Clicks:** one aggregate event per GET (client analytics kind `short_link`: link type and source
  from the Referer host), counted by the processor as daily site counters (`analytics_daily`, entity
  `site`, id `short-links`). No id, IP or user agent is stored. Crawlers, previews, prefetches and HEAD
  are not counted. Read with admin-api `GET /api/content/analytics/visits?days=` (`shortLinks`).

## Hosts

| Tier | Host | Worker | Config |
|---|---|---|---|
| QA | `qa.alummahnow.link` | `al-ummah-now-short-links-qa` | `wrangler.qa.jsonc` (deploy.yml `deploy-qa`, then the smoke) |
| Stage | `stage.alummahnow.link` | `al-ummah-now-short-links-stage` | `wrangler.jsonc` `env.stage` (release.yml) |
| Production | `alummahnow.link` | `al-ummah-now-short-links` | `wrangler.jsonc` (release.yml) |
| Local stack | `http://localhost:3092` | (Miniflare) | `scripts/local-stack/stack.ts` |

Each host is a **Workers Custom Domain** on the `alummahnow.link` zone: `wrangler deploy` creates its
DNS record and certificate. The web app finds its short link host from its API host
(`shortLinkOriginFor` in shared-types), or from `SHORT_LINK_URL` (`off` turns short links off).

## Commands

```bash
pnpm --filter @al-ummah/short-links test         # routing, 404s, cache, clicks, robots
pnpm --filter @al-ummah/short-links type-check
node --experimental-strip-types scripts/release/short-links-smoke.ts --env qa   # against a deployed tier
```
