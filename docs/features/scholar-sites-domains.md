# Scholar sites: own domains

Owner decision SS16 and wiki AUN-SCHOLAR-SITES §4.2, issue #1212. A white-label site can use the scholar's own domains as well as its `<slug>.alummahnow.org` address. They are Cloudflare for SaaS custom hostnames on the `alummahnow.org` zone (`c3cbc1b54070d957cdcef91444b746a9`), served by the one shared sites Worker.

## Who does what

| Piece | Where |
|---|---|
| Cloudflare calls (create, read, delete custom hostname) | admin-api `src/lib/sites/saas.ts`, token `SITES_SAAS_TOKEN` = Secrets Store `sites-saas-token` (Zone → SSL and Certificates: Edit on alummahnow.org) |
| Add / check / remove / main address, audit, status checks | admin-api `src/lib/sites/domains.ts`, `src/routers/siteDomains.router.ts`, D1 `site_domain_checks` (migration 0023) |
| Domain state, host index, permissions | api-videos `src/lib/sites/domains.ts`; `/internal/sites/:channelId/domains…`, `/primary`, `/editor` |
| Staff screen | admin-web Scholar sites → a site → Own domains (`SiteDomainsPanel`), needs creators:manage to change |
| Owner screen | Studio → Site → Domains (`SiteDomains`), for the channel owner and admins (`channel.edit`), through `/api/studio/site-domains/*` on the videos site, which forwards to admin-api `/internal/site-domains` with the internal key and the user's token |

## Flow

1. **Add.** api-videos checks the domain: its shape, that it is not a platform host and not already on this site, and the plan's `site.customDomains.max`. It claims the host in the create-only host index; a host another site holds is refused (`host_taken`) before Cloudflare is asked. admin-api then creates the custom hostname (DV certificate, TXT validation) and records its DNS records and status. If Cloudflare refuses, the reservation is undone.
2. **DNS.** The owner adds the records shown:
   - a CNAME from the domain to `sites.alummahnow.org`;
   - the ownership TXT;
   - the certificate TXT.

   A bare domain needs CNAME flattening or ALIAS, or a redirect to `www`.
3. **Status.** The domain moves through `waiting_dns` → `issuing` → `live` (or `failed`, with Cloudflare's reason). The admin-api cron reads only the due rows of `site_domain_checks` (indexed on `next_check_at`, at most 25 per tick). It checks every 10 minutes for 72 hours after adding, then daily. Studio checks again every 30 s while the page is open and a domain is pending. "Check now" checks at once.
4. **Live.** The domain joins the site's `hosts` (kind `custom`), so the sites Worker serves it. The owner can make it the main address; every other host then redirects to it.
5. **Remove.** This deletes the Cloudflare hostname, frees the host index entry and stops the checks. The main address falls back to the subdomain. A live domain that stops verifying leaves `hosts` the same way.

## Before Cloudflare for SaaS is on

Until the owner enables Cloudflare for SaaS on `alummahnow.org`, Cloudflare answers 1404 ("no quota"), and admin-api returns `503 saas_unavailable`. Both screens then say own domains aren't available yet, and nothing is reserved. A missing token gives the same answer. Once SaaS is on, the one-time zone setup (fallback origin `sites.alummahnow.org`) is AlUmmahNowUI `apps/sites/docs/DOMAINS.md` §0. Run the "Sites zone" workflow with `mode=apply`.

## Tests

- api-videos `test/site-domains.spec.ts`: rules, host index, limit, live → hosts, main address, fallbacks and internal routes.
- admin-api `test/site-domains.test.ts`: a mocked Cloudflare covering records, status mapping, 1404, the cron, permissions and the Studio key + token + `channel.edit` check.
- web `SiteDomains.test.tsx`: the screen, errors in words, the in-app remove dialog and the proxy's route map.
