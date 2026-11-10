# Admin soft delete (Recently deleted, 30-day cleanup)

Owner rule (2026-11-10): every delete made in the videos admin is a soft delete. The item is
hidden at once and stays restorable for 30 days. After that, a scheduled cleanup deletes it
permanently. An admin may "Delete permanently now", which only queues the item for the next
cleanup run. The cleanup is the one path that hard-deletes admin content.

| Step | What happens | Where |
|---|---|---|
| Delete | The item is flagged (`isDeleted` plus an `admin:deleted` / `deleted-channel:<id>` / `deleted-user:<id>` hold, or `status: 'deleted'` for posts) and a row goes into `admin_deletions` (deleted_at, deleted_by, reason). Public reads, admin lists, search and the ownership index drop it. Nothing is removed from R2, Bunny or the indexes. | api-videos `lib/admin/service.ts` |
| Restore | Admin only (`content:delete`, plus `users:manage` for user data), in-app confirm dialog, audited. The flag and hold are lifted and the row is removed. Refused (409 `purge_in_progress`) once the cleanup has started the purge. | `POST /api/content/deletions/:kind/:id/restore` |
| Recently deleted | `/deleted` in admin-web, per area (`?kind=`), showing who, when, the reason, the days left or "Queued for permanent deletion", and the last cleanup run. | admin-web `app/(protected)/deleted` |
| Delete permanently now | `content:purge` (admin, super admin). In-app dialog: type the item id to confirm. Audited as `purge-request`. Sets `purge_requested_at/by`; still restorable until the next cleanup run. | `POST /api/content/deletions/:kind/:id/purge` |
| Cleanup | api-videos hourly cron `47 * * * *`. Picks rows that are 30 days old, queued, or purging (at most 50 per run). Comments, playlists and posts are erased inline. Videos, channels and users go through their admin job (`video.purge`, `channel.purge`, `user.delete-data`: R2, Bunny Stream, search and ownership indexes, notifications, handle). The row is marked purged when the job succeeds. A failed job is retried on the next run (`attempts`, `last_error`). It logs `[DeletionCleanup] Run finished` with `metric: admin_deletions_cleanup` and stores the run summary in `search_meta`. | api-videos `lib/admin/deletions.ts` |

Every purge step is idempotent: an item that is already gone counts as done, and a restored
item is skipped. The purge jobs check that the item is still deleted before they erase it.

Admin-api-owned items (contact messages, theme packages, creator tiers) follow the same rule
and are covered separately.
