# Newsletter

AlUmmahNowUI#6 (wiki CMS-QUEUE). People sign up in the www footer; admins write issues on the videos
admin **Newsletter** page (`/newsletter`, Site group) and send them to confirmed subscribers.

## Flow

1. **Sign-up** (www footer form → www server → admin-api `POST /internal/newsletter/subscribe`, X-API-Key
   `INTERNAL_API_KEY`, visitor IP as `X-Client-IP`). Hidden `website` field for bots, Turnstile
   (`checkHuman`, endpoint `www.newsletter`, `TURNSTILE_MODE`), 10 sign-ups per IP per hour on production.
   Always the same answer (`check_email`), so the form never tells whether an address is subscribed.
2. **Double opt-in.** A new (or unsubscribed) address becomes `pending` with a 7-day confirmation token;
   only its SHA-256 is stored. The token rides in the `newsletter_confirm` queue job to the email
   (`/{l}/newsletter/confirm?token=` on www). A second request within 10 minutes sends nothing; a later
   one sends a new link and the old one stops working. Already confirmed: nothing is sent.
3. **Confirm / unsubscribe pages** on www show a button that POSTs (mail scanners open links, so a GET
   never changes anything). Every issue carries the unsubscribe link plus RFC 8058 headers
   `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the one-click POST goes to
   the same www URL.
4. **Issues** are drafts until sent; sending needs subject and text in English and Arabic. Each
   subscriber gets the language they signed up in. Plain text: blank lines split paragraphs, a line that
   is only an `https://` address becomes a link.

## Sending (queues)

All newsletter mail rides `CONTACT_MAIL_QUEUE` (shared Resend sender, consumer
`lib/contact-mail-queue.ts`; no new queue): `newsletter_fanout` pages confirmed subscribers 100 at a time
into `newsletter_deliveries` rows and one `newsletter_send` job each. Retries back off 30 s → 15 min, six
attempts. A final failure marks the row `failed`, goes to the platform DLQ (`ERRORS_DLQ`, never with the
token) and opens an Errors page item with **Send again** (`newsletter-email` in `lib/errors-actions.ts`:
a new confirmation link, or the issue's failed deliveries queued again). A delivery already sent is never
sent again; Resend gets `Idempotency-Key: newsletter-<issue>-<subscriber>`. Someone who unsubscribes
before their email goes out is `skipped`.

## Admin

`newsletter:manage` (admins, super admins). `/api/newsletter`: subscribers (list, search, erase for a
privacy request) and issues (create, edit and delete drafts, send). Every change is in `admin_audit_log`;
an erase keeps no address. Unsubscribe tokens never leave admin-api.

## Data

REPORTS_DB `0028_newsletter.sql`: `newsletter_subscribers`, `newsletter_issues`, `newsletter_deliveries`.
`NEWSLETTER_SITE_URL` (wrangler vars) is the www origin of the links.

## Cost

Resend: free tier 3,000 emails/month (100/day); Pro is $20/month for 50,000. With no subscribers today it
costs nothing; queue operations (3 per email) are inside the Workers Paid allowance.
