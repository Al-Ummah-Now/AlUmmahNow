# Scholar sites: Studio self-service

Owner decision SS16 (2026-11-13): staff set a site up in the admin, and channel owners run it themselves in Studio from day one. Phase 3's self-service moved into phase 2. Wiki AUN-SCHOLAR-SITES §7.1.

## Studio → Site

| Area | What it does | Stored |
|---|---|---|
| Checklist | Logo, About, first page, home, own domain (when the plan has domains) | computed |
| Theme & brand, languages, About | As before (phase 2 MVP) | site settings |
| Menu | Home, Videos, Shorts, Posts, About, **a site page**, outside link; up to `site.navigation.max` | `navigation` (`kind: 'page'` + `pageId`) |
| Home | A site page whose blocks show above the channel's Home sections | `home.pageId` |
| Search engines | Title template (`%s` = page title), description en/ar, Google/Bing verification codes | `seo` |
| Redirects | Old paths on the site → a path or an https:// address; up to 50 | `redirects` |
| Pages | Block pages (text, image, video, button, quote, divider, latest posts, latest videos) per language, draft/published, last 10 versions restorable, preview, delete in the in-app dialog; up to `site.pages.max` | `site/{channelId}/pages/{pageId}.json` plus `pages` (the list) in the settings |
| Domains | Own domains (docs/features/scholar-sites-domains.md) | `domains` |

Who may edit:
- **Settings**: the owner and channel admins (`channel.edit`).
- **Pages**: also editors (`post.manage`).
- **Logo, favicon and page images**: the community image upload, open to the owner, admins and editors (#1213).

## API (api-videos `routers/sites.router.ts`)

- Studio: `GET|POST /api/sites/channel/:channelId/pages`, `GET|PUT|DELETE …/pages/:pageId` (ETag `If-Match`), `POST …/pages/:pageId/restore { index }`.
- Sites Worker: `GET /api/sites/by-host/:host/pages/:slug` (published; drafts with a valid `?preview=`), `GET /api/sites/by-host/:host/home`. The by-host site now carries `pages` (published), `home`, `seo` and `redirects`.

Every read is one object by key: never a list or scan. A deleted page leaves the menu and the home.

Rendering on the sites Worker (pages, home blocks, SEO tags, redirects) is in AlUmmahNowUI `apps/sites`.
