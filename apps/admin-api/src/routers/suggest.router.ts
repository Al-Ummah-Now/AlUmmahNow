/**
 * /api/suggest/* — the admin autocomplete.
 *
 *   GET /api/suggest/:kind?q=…&limit=…  suggestions while the admin types
 *   GET /api/suggest/:kind?q=&cursor=…   a picker's page before anything is typed
 *                                       (newest first; `next` is the cursor of the page after)
 *   GET /api/suggest/:kind/:id          one item by id (the chip of an active filter)
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts). Content kinds are
 * readable by every admin role, like the content lists; contact messages need
 * contact:read and error groups errors:read. Suggestions are reads, so they
 * write no audit row (the lists they mirror do not either).
 *
 * Content comes from the same api-videos admin lists the list pages use (they
 * match name, @handle, email, title and exact id), so a suggestion never shows
 * something the list would not.
 */
import { Hono, type Context } from 'hono';
import {
  ADMIN_SUGGEST_KINDS,
  ADMIN_SUGGEST_INITIAL_LIMIT,
  ADMIN_SUGGEST_LIMIT,
  type AdminChannelRow,
  type AdminCommentRow,
  type AdminPage,
  type AdminPlaylistRow,
  type AdminPostRow,
  type AdminSuggestKind,
  type AdminSuggestion,
  type AdminUserRow,
  type AdminVideoRow,
} from '@al-ummah/shared-types';
import { callVideos, VideosError, type VideosClientEnv } from '../lib/content/videosClient';
import { getContactMessage, listContactMessages, type ContactMessageRow } from '../lib/contact-store';
import { getErrorGroup, listErrorGroups, type ErrorGroupRow } from '../lib/errors-store';
import { hasPermission, type Permission } from '../lib/roles';
import { logger } from '../lib/logger';
import { getInvite, inviteStatusByUser, listInvites, toView, type InviteView } from '../lib/invites';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

/** Longest query passed on: ids, emails and titles all fit. */
const MAX_QUERY = 200;
/** Longest label or secondary text sent back (comments and messages can be long). */
const MAX_TEXT = 140;

const PERMISSION: Partial<Record<AdminSuggestKind, Permission>> = { contact: 'contact:read', error: 'errors:read' };

const clip = (text: string | null | undefined): string | null => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};

const isKind = (kind: string): kind is AdminSuggestKind => (ADMIN_SUGGEST_KINDS as readonly string[]).includes(kind);

// ---------------------------------------------------------------------------
// Row → suggestion
// ---------------------------------------------------------------------------

const fromChannel = (r: AdminChannelRow): AdminSuggestion => ({
  kind: 'channel',
  id: r.id,
  label: clip(r.name) ?? r.id,
  secondary: r.handle ? `@${r.handle}` : clip(r.ownerEmail),
  imageUrl: r.avatarUrl,
});

const fromUser = (r: AdminUserRow): AdminSuggestion => ({
  kind: 'user',
  id: r.id,
  label: clip(r.displayName) ?? r.userName ?? r.id,
  secondary: [r.userName ? `@${r.userName}` : null, r.email].filter(Boolean).join(' · ') || null,
  imageUrl: r.avatarUrl,
});

const fromVideo = (r: AdminVideoRow): AdminSuggestion => ({
  kind: 'video',
  id: r.id,
  label: clip(r.title) ?? r.id,
  secondary: clip(r.channelName),
  imageUrl: r.thumbnailUrl,
  parentId: r.channelId,
});

/** A bilingual playlist's other names (EN/AR), so either language can be recognised in the list. */
const otherPlaylistNames = (r: AdminPlaylistRow): string | null => {
  const names = [...new Set(Object.values(r.titleLocalized ?? {}).map((n) => n.trim()))].filter((n) => n && n !== r.title?.trim());
  return clip(names.join(' · ')) ?? null;
};

const fromPlaylist = (r: AdminPlaylistRow): AdminSuggestion => ({
  kind: 'playlist',
  id: r.id,
  label: clip(r.title) ?? r.id,
  secondary: otherPlaylistNames(r),
  imageUrl: null,
  parentId: r.channelId,
});

const fromPost = (r: AdminPostRow): AdminSuggestion => ({
  kind: 'post',
  id: r.id,
  label: clip(r.text) ?? r.id,
  secondary: r.type,
  imageUrl: null,
  parentId: r.channelId,
});

const fromComment = (r: AdminCommentRow): AdminSuggestion => ({
  kind: 'comment',
  id: r.id,
  label: clip(r.text) ?? r.id,
  secondary: clip(r.videoTitle),
  imageUrl: null,
  parentId: r.videoId,
});

const fromContact = (r: ContactMessageRow): AdminSuggestion => ({
  kind: 'contact',
  id: r.id,
  label: clip(r.name) ?? r.id,
  secondary: clip(`${r.email} · ${r.message}`),
  imageUrl: null,
});

const fromInvite = (r: InviteView): AdminSuggestion => ({
  kind: 'invite',
  id: r.id,
  label: r.email,
  secondary: clip(r.name),
  imageUrl: null,
});

const fromError = (r: ErrorGroupRow): AdminSuggestion => ({
  kind: 'error',
  id: r.id,
  label: clip(r.message) ?? r.id,
  secondary: [r.app, r.name, r.route].filter(Boolean).join(' · ') || null,
  imageUrl: null,
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const CONTENT_PATH = { channel: '/channels', user: '/users', video: '/videos', playlist: '/playlists', post: '/posts', comment: '/comments' } as const;
type ContentKind = keyof typeof CONTENT_PATH;
const CONTENT_MAP: Record<ContentKind, (row: any) => AdminSuggestion> = {
  channel: fromChannel,
  user: fromUser,
  video: fromVideo,
  playlist: fromPlaylist,
  post: fromPost,
  comment: fromComment,
};

async function search(c: C, kind: AdminSuggestKind, q: string, limit: number): Promise<AdminSuggestion[]> {
  if (kind === 'contact') {
    const { messages } = await listContactMessages(c.env.REPORTS_DB, { q, limit, offset: 0 });
    return messages.map(fromContact);
  }
  if (kind === 'error') {
    const { groups } = await listErrorGroups(c.env.REPORTS_DB, { q, limit, offset: 0 });
    return groups.map(fromError);
  }
  if (kind === 'invite') {
    const { items } = await listInvites(c.env.REPORTS_DB, { q, limit });
    return items.map(fromInvite);
  }
  const page = await callVideos<AdminPage<unknown>>(c.env, CONTENT_PATH[kind], {
    query: { q, pageSize: limit },
    actorId: c.get('auth')?.userId,
  });
  const suggestions = page.items.map(CONTENT_MAP[kind]);
  return kind === 'user' ? withInviteBadges(c, suggestions) : suggestions;
}

/**
 * A picker opening (owner rule 2026-11-11: pickers open with content): the
 * newest items of the kind, a page at a time. Content kinds ask api-videos for
 * the list without its total (`noTotal`), so each page is one indexed, limited
 * read (users come straight off the profiles' created_at index); playlists and
 * posts page with the store's cursor. `next` is null after the last page.
 */
async function initialPage(c: C, kind: AdminSuggestKind, cursor: string, limit: number): Promise<{ items: AdminSuggestion[]; next: string | null }> {
  const page = Math.max(1, Math.floor(Number(cursor) || 1));
  const offset = (page - 1) * limit;
  const nextPage = (count: number) => (count >= limit ? String(page + 1) : null);
  if (kind === 'contact') {
    const { messages } = await listContactMessages(c.env.REPORTS_DB, { limit, offset });
    return { items: messages.map(fromContact), next: nextPage(messages.length) };
  }
  if (kind === 'error') {
    const { groups } = await listErrorGroups(c.env.REPORTS_DB, { limit, offset });
    return { items: groups.map(fromError), next: nextPage(groups.length) };
  }
  if (kind === 'invite') {
    const { items, nextCursor } = await listInvites(c.env.REPORTS_DB, { limit, ...(cursor ? { cursor } : {}) });
    return { items: items.map(fromInvite), next: nextCursor };
  }
  if (kind === 'playlist' || kind === 'post') {
    const result = await callVideos<{ items: unknown[]; nextCursor: string | null }>(c.env, CONTENT_PATH[kind], {
      query: { pageSize: limit, ...(cursor ? { cursor } : {}) },
      actorId: c.get('auth')?.userId,
    });
    return { items: result.items.map(CONTENT_MAP[kind]), next: result.nextCursor ?? null };
  }
  const result = await callVideos<AdminPage<unknown>>(c.env, CONTENT_PATH[kind], {
    query: { pageSize: limit, page, sort: 'newest', noTotal: '1' },
    actorId: c.get('auth')?.userId,
  });
  const suggestions = result.items.map(CONTENT_MAP[kind]);
  return { items: kind === 'user' ? await withInviteBadges(c, suggestions) : suggestions, next: nextPage(result.items.length) };
}

/** Invited users who have not signed in yet are pickable like any user, with an "Invited" badge. */
async function withInviteBadges(c: C, suggestions: AdminSuggestion[]): Promise<AdminSuggestion[]> {
  const invites = await inviteStatusByUser(c.env.REPORTS_DB, suggestions.map((s) => s.id)).catch(() => new Map());
  return suggestions.map((s) => {
    const status = invites.get(s.id)?.status;
    return status && status !== 'active' && status !== 'revoked' ? { ...s, badge: 'invited' as const } : s;
  });
}

async function byId(c: C, kind: AdminSuggestKind, id: string): Promise<AdminSuggestion | null> {
  if (kind === 'contact') {
    const row = await getContactMessage(c.env.REPORTS_DB, id);
    return row ? fromContact(row) : null;
  }
  if (kind === 'error') {
    const row = await getErrorGroup(c.env.REPORTS_DB, id);
    return row ? fromError(row) : null;
  }
  if (kind === 'invite') {
    const row = await getInvite(c.env.REPORTS_DB, id);
    return row ? fromInvite(toView(row)) : null;
  }
  // Every content list matches an exact id in q except comments, which have no page of their own
  if (kind === 'comment') return null;
  const items = await search(c, kind, id, ADMIN_SUGGEST_LIMIT);
  return items.find((s) => s.id === id) ?? null;
}

/** An exact id match goes first: a pasted id should be the top suggestion. */
function exactFirst(items: AdminSuggestion[], q: string): AdminSuggestion[] {
  const exact = items.findIndex((s) => s.id === q);
  if (exact <= 0) return items;
  return [items[exact], ...items.slice(0, exact), ...items.slice(exact + 1)];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Unknown kind (404) or a kind the role may not read (403); null when the request may go on. */
function refuse(c: C, kind: string): Response | null {
  if (!isKind(kind)) return c.json({ success: false, code: 'unknown_kind', error: `Unknown suggestion kind: ${kind}` }, 404);
  const permission = PERMISSION[kind];
  if (permission && !hasPermission(c.get('auth')?.roles, permission)) {
    logger.warn('[Suggest] Permission denied', { userId: c.get('auth')?.userId, permission, kind });
    return c.json({ success: false, code: 'forbidden', error: `Permission required: ${permission}` }, 403);
  }
  return null;
}

function failed(c: C, kind: string, error: unknown): Response {
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[Suggest] Search failed', { kind, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
}

app.get('/:kind', async (c) => {
  const kind = c.req.param('kind');
  const refused = refuse(c, kind);
  if (refused) return refused;
  const q = (c.req.query('q') ?? '').trim().slice(0, MAX_QUERY);
  if (!q) {
    // A picker opening: its first page (or the page at `cursor`) instead of nothing
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || ADMIN_SUGGEST_INITIAL_LIMIT, 1), 50);
    try {
      const { items, next } = await initialPage(c, kind as AdminSuggestKind, (c.req.query('cursor') ?? '').slice(0, 2000), limit);
      logger.debug('[Suggest] Initial page', { kind, count: items.length, more: !!next });
      return c.json({ success: true, result: { items, next } });
    } catch (error) {
      return failed(c, kind, error);
    }
  }
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || ADMIN_SUGGEST_LIMIT, 1), 20);
  try {
    const items = exactFirst(await search(c, kind as AdminSuggestKind, q, limit), q).slice(0, limit);
    logger.debug('[Suggest] Suggestions', { kind, length: q.length, count: items.length });
    return c.json({ success: true, result: { items } });
  } catch (error) {
    return failed(c, kind, error);
  }
});

app.get('/:kind/:id', async (c) => {
  const kind = c.req.param('kind');
  const refused = refuse(c, kind);
  if (refused) return refused;
  const id = c.req.param('id').trim().slice(0, MAX_QUERY);
  try {
    return c.json({ success: true, result: { item: id ? await byId(c, kind as AdminSuggestKind, id) : null } });
  } catch (error) {
    return failed(c, kind, error);
  }
});

export default app;
