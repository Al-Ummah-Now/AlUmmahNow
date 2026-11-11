# Admin queues: Action needed and History

Every queue in the videos admin works the same way. A queue has two tabs:

- **Action needed** (the default) lists only the items that still need a decision, oldest first.
- **History** lists the items someone has handled, showing who did what and when, newest first.

Both tabs use the same search and filters. The filters are URL query parameters, so a filtered view can be bookmarked and shared. Each response carries the count for both tabs, for the tab badges.

This page covers AI moderation flags, contact messages and errors. Reports follow the same contract in their own PR. The types live in `packages/shared-types/src/admin-queue.ts`. The code is in `apps/admin-api/src/lib/queue/`.

## Endpoints

| Queue | Endpoint | Permission | Row type |
| --- | --- | --- | --- |
| AI moderation flags | `GET /api/moderation/ai/queue` | any admin role (as `/ai/signals`) | `AiQueueItem` |
| Contact messages | `GET /api/contact/queue` | `contact:read` | `ContactQueueItem` |
| Errors | `GET /api/errors/queue` | `errors:read` | `ErrorQueueItem` |

All three answer `{ success: true, result: AdminQueuePage<Row> }`:

```ts
{
  tab: 'action' | 'history',
  items: Row[],
  total: number,                              // = counts[tab]
  counts: { action: number, history: number }, // both tabs, same filters
  limit: number,
  offset: number,
}
```

The older list endpoints (`/ai/signals`, `/contact/messages`, `/errors/groups`) and their parameters are unchanged. The queue endpoints were added next to them.

## Query parameters

The parameters have the same names and meaning on every queue. Each one is optional.

| Parameter | Meaning |
| --- | --- |
| `q` | Search, up to 200 characters. The list and its live autocomplete both send it (with a small `limit` for the suggestions). |
| `tab` | `action` (default) or `history`. |
| `from`, `to` | UTC days (`YYYY-MM-DD`), inclusive, on the tab's date. On Action needed this is when the item came in. On History it is when the item was handled. |
| `actor` | Who handled it: a user id or `me`. Applies to History only. |
| `outcome` | What was done (see the table below). Applies to History only. |
| `type` | The kind of item. AI: surface (`video_comment`, `community_post`, `post_comment`, `video_metadata`). Errors: error kind (`unhandled`, `fetch`, `action`, and so on). |
| `category` | The reason. AI: signal category (`S1`–`S14` or an extension such as `spam`). Contact: topic. |
| `assignee` | `me`, `unassigned` or a user id. Contact and errors only. |
| `sort` | `oldest` or `newest`, on the tab's date. Action needed defaults to `oldest` and History to `newest`. AI also offers `priority`. Errors also offer `count` and `users`. |
| `limit`, `offset` | Page size (1–100, default 25) and offset. All three queues already used offset paging. |

Errors also take `app`, `environment` and `includeTest=1`. Test groups from the release E2E are hidden unless `includeTest=1` is set or the search is an `ERR-…` reference.

Filters that only exist on History (`actor`, `outcome`) do not change the Action needed count. Every other filter applies to both counts, so the badges always match what each tab would show.

## What each tab holds

| Queue | Action needed | History | `outcome` values |
| --- | --- | --- | --- |
| AI moderation | Flags awaiting review (`review_status = 'pending'`) that no reviewer has acted on. | Flags a reviewer agreed or disagreed with, hid or restored. | `agree`, `disagree`, `hide`, `restore` |
| Contact | `new` and `open` messages (still waiting for a reply), plus any message whose delivery finally failed (`send_failed`), whatever its status. | `replied`, `closed` and `spam` messages with no failed delivery. | `replied`, `closed`, `spam` |
| Errors | `new` and `acknowledged` groups, plus any group with an open needs-action item, whatever its status. | `resolved` and `ignored` groups with nothing open. | `resolved`, `ignored` |

Migration `0019_admin_queues.sql` records who handled an item, and when, on the item's own row (`handled_*` columns). History is filtered and sorted by these columns, using an index, instead of reading the audit logs. The columns are written by:

- AI: `reviewSignal` (agree, disagree) and `setCommentHidden` (hide, restore).
- Contact: `updateContactMessage` when the status moves to replied, closed or spam. Saving the same status again keeps the first handler. A delivered reply records the reply's author (`recordDelivery`).
- Errors: `setErrorStatus` when a group is resolved or ignored.

The migration fills in these columns for items handled before it ran, using the audit logs: `moderation_actions`, the reply notes and `error_group_activity`. Contact messages closed or marked as spam before the migration have a time but no handler, because the handler was not recorded.

## Search

| Queue | `q` matches |
| --- | --- |
| AI moderation | The flagged item's title or text (video title, comment text, post text), the author's name, handle or email, the channel's name or handle, the category (code or name, so "hate" matches `S10` and `sectarian_hate`), and an exact signal, subject, author or channel id. A comment on a video whose title matches is found too. |
| Contact | Sender name and email, message text, topic, and an exact message id. |
| Errors | Message, culprit, route, error name, app, group id, a reference `ERR-XXXX-XXXX` (typed loosely too), and a request id. |

The AI queue stores ids only. It keeps no copy of the content, so edits and erasure take effect at once. To search by name, the queue first looks up the matching ids in the search index (`SEARCH_DB`, owned by api-videos: `content_ownership`, `admin_comments`, `search_posts`). That is one batch of up to 200 ids per kind. The queue then filters its own rows by those ids, using `json_each` lists, in the same batch as the page and the counts.

## Rows carry names and links

Rows show names, not ids. A person is `{ id, name }`, where `name` is the profile's display name, then the handle, then the email stored on the item. It is `null` only when nothing but the id is known; the UI then shows "Unknown" (`ADMIN_QUEUE_LABELS`). The names for a whole page come from one search-index batch, never from one call per row. Without `SEARCH_DB`, rows fall back to the stored email and the queue still works.

Every row has `link: { kind, id, parentId? }`, and `kind` is one of the admin's suggestion kinds:

- AI flags link to their `video`, to their `comment` (`parentId` = video), or to their `post` (`parentId` = channel). A comment on a post links to the post.
- Contact rows link to `contact`.
- Errors rows link to `error`.

`handled` is `{ outcome, by, at }` on History rows and `null` on Action needed rows.

## Labels

`ADMIN_QUEUE_LABELS` in shared-types has the English and Arabic labels for the tab names, the outcomes and "Unknown".
