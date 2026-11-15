'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check, Heart, MessageSquareReply, MoreVertical, Pin, RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react';
import Link from '@/components/common/AppLink';
import ReportContentButton from '@/components/moderation/ReportContentButton';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { createComment } from '@/lib/api/video-comments';
import { createPostComment } from '@/lib/api/post-comments';
import {
  actOnComments,
  blockFromChannel,
  listChannelBlocks,
  listChannelComments,
  unblockFromChannel,
  type BulkItem,
  type ChannelBlock,
  type StudioComment,
  type StudioCommentAction,
  type StudioCommentTab,
} from '@/lib/api/studio-comments';
import { formatRelativeTime } from '@/lib/format/videoMeta';
import { logger } from '@/lib/logger-client';
import { can, type StudioRole } from '@/lib/studio/permissions';
import { cn } from '@/lib/utils';

export const COMMENT_TABS: readonly StudioCommentTab[] = ['inbox', 'held', 'removed'];
/** The bulk route takes up to 50 comments (spec §4.7) */
export const MAX_COMMENT_SELECTION = 50;
const PAGE_SIZE = 20;
const DEFAULT_AVATAR = '/avatar.png';

export function parseCommentTab(value: string | string[] | undefined): StudioCommentTab {
  return value === 'held' || value === 'removed' ? value : 'inbox';
}

/** `video:<id>` or `post:<id>`, anything else is ignored */
export function parseCommentTarget(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && /^(video|post):[\w-]{1,128}$/.test(value) ? value : undefined;
}

const itemOf = (comment: StudioComment): BulkItem => ({ kind: comment.kind, targetId: comment.targetId, commentId: comment.id });

interface Props {
  locale: string;
  channel: { id: string; name: string };
  role: StudioRole;
  tab: StudioCommentTab;
  target?: string;
}

/**
 * Comments (spec §4.7): the channel's video and post comments in one place.
 * Inbox, Held for review and Removed (90 days, with Restore), search and
 * filters, per-comment actions and bulk Approve / Remove / Restore. The page
 * guard checked comment.moderate; every action is checked again by the API.
 */
export function CommentsTab({ locale, channel, role, tab, target }: Props) {
  const { t } = useLanguage();
  const text = t.studio.commentsPage;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const base = `/${locale}/studio/${encodeURIComponent(channel.id)}/comments`;
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const { confirm, dialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [noReply, setNoReply] = useState(false);
  const [hasLink, setHasLink] = useState(false);
  const [items, setItems] = useState<StudioComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reportOf, setReportOf] = useState<StudioComment | null>(null);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const loadId = useRef(0);

  // Search waits for a pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (more?: string) => {
    const id = ++loadId.current;
    if (more) setLoadingMore(true);
    else setState('loading');
    const page = await listChannelComments(channel.id, { tab, q: query || undefined, target, noReply, hasLink, cursor: more, limit: PAGE_SIZE });
    if (id !== loadId.current) return;
    setLoadingMore(false);
    if (!page) {
      logger.error('[Studio] Comments not loaded', { channelId: channel.id, tab });
      if (!more) setState('error');
      else setNotice(text.loadFailed);
      return;
    }
    setItems((prev) => (more ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setIndexing(!!page.indexing);
    setState('ready');
    if (!more) setSelected(new Set());
  }, [channel.id, tab, query, target, noReply, hasLink, text.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtering = !!query || !!target || noReply || hasLink;
  const targetTitle = target ? items.find((c) => `${c.kind}:${c.targetId}` === target)?.targetTitle : undefined;

  /** Runs one action on some comments; returns the ids that succeeded */
  const run = async (action: StudioCommentAction, comments: StudioComment[]): Promise<Set<string>> => {
    setBusy(true);
    setNotice(null);
    const results = await actOnComments(channel.id, action, comments.map(itemOf));
    setBusy(false);
    if (!results) {
      logger.error('[Studio] Comment action failed', { channelId: channel.id, action, count: comments.length });
      setNotice(text.failed);
      return new Set();
    }
    const ok = new Set(results.filter((r) => r.ok).map((r) => r.commentId));
    const failed = results.filter((r) => !r.ok);
    if (comments.length === 1) {
      const error = failed[0]?.error;
      setNotice(failed.length === 0 ? text.done[action] : error === 'held_by_moderation' ? text.errors.held_by_moderation : text.failed);
    } else {
      setNotice(text.bulk.result.replace('{ok}', numberFormat.format(ok.size)).replace('{failed}', numberFormat.format(failed.length)));
    }
    return ok;
  };

  // Approve, remove, restore and hold move a comment to another list
  const moveOut = async (action: StudioCommentAction, comments: StudioComment[]) => {
    const ok = await run(action, comments);
    if (ok.size === 0) return;
    setItems((prev) => prev.filter((c) => !ok.has(c.id)));
    setSelected((prev) => new Set([...prev].filter((id) => !ok.has(id))));
  };

  const remove = async (comments: StudioComment[]) => {
    const confirmed = await confirm({
      title: text.removeConfirm.title,
      description: text.removeConfirm.body,
      confirmLabel: text.removeConfirm.confirm,
      testId: 'studio-comment-remove-dialog',
    });
    if (confirmed) await moveOut('remove', comments);
  };

  const toggleFlag = async (comment: StudioComment, action: 'pin' | 'unpin' | 'heart' | 'unheart') => {
    const ok = await run(action, [comment]);
    if (!ok.has(comment.id)) return;
    setItems((prev) => prev.map((c) => {
      if (action === 'heart' || action === 'unheart') return c.id === comment.id ? { ...c, isHearted: action === 'heart' } : c;
      // One pinned comment per video or post: pinning replaces the old one
      if (c.kind === comment.kind && c.targetId === comment.targetId) return { ...c, isPinned: action === 'pin' && c.id === comment.id };
      return c;
    }));
  };

  const block = async (comment: StudioComment) => {
    const name = comment.author.displayName;
    const confirmed = await confirm({
      title: text.blockConfirm.title.replace('{name}', name),
      description: text.blockConfirm.body,
      confirmLabel: text.blockConfirm.confirm,
      testId: 'studio-comment-block-dialog',
    });
    if (!confirmed) return;
    setBusy(true);
    const ok = await blockFromChannel(channel.id, comment.author.userId);
    setBusy(false);
    if (!ok) logger.error('[Studio] Block failed', { channelId: channel.id });
    setNotice(ok ? text.done.block.replace('{name}', name) : text.failed);
  };

  const selectable = items.filter((c) => !(tab === 'held' && c.heldBy === 'moderation'));
  const allSelected = selectable.length > 0 && selectable.slice(0, MAX_COMMENT_SELECTION).every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.slice(0, MAX_COMMENT_SELECTION).map((c) => c.id)));
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_COMMENT_SELECTION) next.add(id);
    return next;
  });
  const selectedComments = items.filter((c) => selected.has(c.id));

  const tabLink = (item: StudioCommentTab) => `${base}?tab=${item}${target ? `&target=${encodeURIComponent(target)}` : ''}`;

  return (
    <section className="max-w-5xl" aria-labelledby="studio-comments-heading" data-testid="studio-comments" data-tab={tab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="studio-comments-heading" className="text-lg font-semibold text-foreground">{text.heading}</h2>
        <Button variant="outline" className="min-h-11" onClick={() => setBlocksOpen(true)} data-testid="studio-comments-blocks">
          <Ban aria-hidden="true" className="me-2 h-4 w-4" />
          {text.blocks.open}
        </Button>
      </div>

      <nav aria-label={text.tabsLabel} className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {COMMENT_TABS.map((item) => (
          <Link
            key={item}
            href={tabLink(item)}
            aria-current={item === tab ? 'page' : undefined}
            data-testid={`studio-comments-tab-${item}`}
            className={cn(
              '-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              item === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {text.tabs[item]}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          dir="auto"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={text.searchPlaceholder}
          aria-label={text.searchPlaceholder}
          className="min-h-11 w-full md:w-72"
          data-testid="studio-comments-search"
        />
        <Button
          variant={noReply ? 'secondary' : 'outline'}
          aria-pressed={noReply}
          className="min-h-11"
          onClick={() => setNoReply((v) => !v)}
          data-testid="studio-comments-filter-noreply"
        >
          {text.filters.noReply}
        </Button>
        <Button
          variant={hasLink ? 'secondary' : 'outline'}
          aria-pressed={hasLink}
          className="min-h-11"
          onClick={() => setHasLink((v) => !v)}
          data-testid="studio-comments-filter-link"
        >
          {text.filters.hasLink}
        </Button>
      </div>

      {target && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="studio-comments-target">
          {targetTitle ? text.filters.target.split('{title}').flatMap((part, i) => (i === 0 ? [part] : [<bdi key="t" className="font-medium text-foreground">{targetTitle}</bdi>, part])) : null}
          <Link href={`${base}?tab=${tab}`} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X aria-hidden="true" className="h-4 w-4" />
            {text.filters.clearTarget}
          </Link>
        </p>
      )}

      {indexing && (
        <p role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm text-foreground" data-testid="studio-comments-indexing">{text.indexing}</p>
      )}

      <p role="status" aria-live="polite" className="sr-only" data-testid="studio-comments-notice">{notice}</p>
      {notice && (
        <p aria-hidden="true" className="mt-3 text-sm text-muted-foreground">{notice}</p>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 md:static" data-testid="studio-comments-bulk-bar">
          <span className="text-sm font-medium">{text.bulk.selected.replace('{count}', numberFormat.format(selected.size))}</span>
          {tab === 'held' && (
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void moveOut('approve', selectedComments)} data-testid="studio-comments-bulk-approve">{text.actions.approve}</Button>
          )}
          {tab !== 'removed' && (
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void remove(selectedComments)} data-testid="studio-comments-bulk-remove">{text.actions.remove}</Button>
          )}
          {tab === 'removed' && (
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void moveOut('restore', selectedComments)} data-testid="studio-comments-bulk-restore">{text.actions.restore}</Button>
          )}
          <Button variant="ghost" className="min-h-11" onClick={() => setSelected(new Set())}>{text.bulk.clear}</Button>
          {selected.size >= MAX_COMMENT_SELECTION && <span className="text-sm text-muted-foreground">{text.bulk.limit.replace('{max}', numberFormat.format(MAX_COMMENT_SELECTION))}</span>}
        </div>
      )}

      <div className="mt-4">
        {state === 'loading' ? (
          <div role="status" aria-label={t.common.loading} className="space-y-3" data-testid="studio-comments-loading">
            {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}
          </div>
        ) : state === 'error' ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 text-card-foreground" data-testid="studio-comments-error">
            <p className="text-sm">{text.loadFailed}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>{text.retry}</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-muted-foreground" data-testid="studio-comments-empty">
            <p className="text-base">{filtering ? text.empty.filtered : text.empty[tab]}</p>
          </div>
        ) : (
          <>
            {selectable.length > 0 && (
              <label className="mb-2 inline-flex min-h-11 items-center gap-3 px-1 text-sm text-muted-foreground">
                <input type="checkbox" className="h-5 w-5" checked={allSelected} onChange={toggleAll} data-testid="studio-comments-select-all" />
                {text.bulk.selectAll}
              </label>
            )}
            <ul className="space-y-3">
              {items.map((comment) => (
                <CommentRow
                  key={comment.id}
                  locale={locale}
                  lang={lang}
                  comment={comment}
                  tab={tab}
                  base={base}
                  channel={channel}
                  canSpeak={can(role, 'channel.speak')}
                  selected={selected.has(comment.id)}
                  onToggle={() => toggleOne(comment.id)}
                  busy={busy}
                  replying={replyingTo === comment.id}
                  onReply={() => setReplyingTo((id) => (id === comment.id ? null : comment.id))}
                  onReplied={(ok) => {
                    setNotice(ok ? text.reply.sent : text.reply.failed);
                    if (ok) {
                      setReplyingTo(null);
                      setItems((prev) => prev.map((c) => (c.id === comment.id ? { ...c, hasChannelReply: true, repliesCount: c.repliesCount + 1 } : c)));
                    }
                  }}
                  onApprove={() => void moveOut('approve', [comment])}
                  onRemove={() => void remove([comment])}
                  onRestore={() => void moveOut('restore', [comment])}
                  onHold={() => void moveOut('hold', [comment])}
                  onFlag={(action) => void toggleFlag(comment, action)}
                  onReport={() => setReportOf(comment)}
                  onBlock={() => void block(comment)}
                />
              ))}
            </ul>
            {cursor && (
              <div className="mt-4 text-center">
                <Button variant="outline" className="min-h-11" disabled={loadingMore} onClick={() => void load(cursor)} data-testid="studio-comments-more">{text.loadMore}</Button>
              </div>
            )}
          </>
        )}
      </div>

      {reportOf && (
        <ReportContentButton
          contentType="comment"
          contentId={reportOf.id}
          contentTitle={reportOf.text.slice(0, 80)}
          hideTrigger
          open
          onOpenChange={(open) => { if (!open) setReportOf(null); }}
        />
      )}
      <BlockedPeople channelId={channel.id} lang={lang} open={blocksOpen} onOpenChange={setBlocksOpen} onNotice={setNotice} />
      {dialog}
    </section>
  );
}

interface RowProps {
  locale: string;
  lang: 'en' | 'ar';
  comment: StudioComment;
  tab: StudioCommentTab;
  base: string;
  channel: { id: string; name: string };
  canSpeak: boolean;
  selected: boolean;
  onToggle: () => void;
  busy: boolean;
  replying: boolean;
  onReply: () => void;
  onReplied: (ok: boolean) => void;
  onApprove: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onHold: () => void;
  onFlag: (action: 'pin' | 'unpin' | 'heart' | 'unheart') => void;
  onReport: () => void;
  onBlock: () => void;
}

function CommentRow({ locale, lang, comment, tab, base, channel, canSpeak, selected, onToggle, busy, replying, onReply, onReplied, onApprove, onRemove, onRestore, onHold, onFlag, onReport, onBlock }: RowProps) {
  const { t } = useLanguage();
  const text = t.studio.commentsPage;
  const heldByModeration = comment.heldBy === 'moderation';
  const isTopLevel = !comment.parentId;
  const time = formatRelativeTime(comment.createdAt, lang);
  const replies = comment.repliesCount === 1 ? text.oneReply : text.replies.replace('{count}', new Intl.NumberFormat(locale).format(comment.repliesCount));
  const canReply = canSpeak && tab !== 'removed' && !heldByModeration;
  const targetKey = `${comment.kind}:${comment.targetId}`;

  return (
    <li
      className={cn('rounded-lg border bg-card p-3 text-card-foreground md:p-4', selected ? 'border-primary' : 'border-border')}
      data-testid="studio-comment"
      data-comment-id={comment.id}
      data-status={comment.status}
    >
      <div className="flex items-start gap-3">
        {!heldByModeration && (
          <input
            type="checkbox"
            className="mt-2 h-5 w-5 shrink-0"
            checked={selected}
            onChange={onToggle}
            aria-label={text.bulk.select.replace('{name}', comment.author.displayName)}
            data-testid="studio-comment-select"
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={comment.author.avatarUrl || DEFAULT_AVATAR} alt="" className="h-9 w-9 shrink-0 rounded-full bg-muted object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <bdi className="font-medium text-foreground">{comment.author.displayName}</bdi>
            <time dateTime={comment.createdAt} className="text-muted-foreground">{time}</time>
            {comment.isPinned && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="studio-comment-pinned"><Pin aria-hidden="true" className="h-3 w-3" />{text.pinned}</span>
            )}
            {comment.isHearted && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="studio-comment-hearted"><Heart aria-hidden="true" className="h-3 w-3 fill-current" />{text.hearted}</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="me-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{comment.kind === 'video' ? text.video : text.post}</span>
            <Link href={`/${locale}${comment.targetUrlPath}`} className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {text.on.split('{title}').flatMap((part, i) => (i === 0 ? [part] : [<bdi key="t">{comment.targetTitle}</bdi>, part]))}
            </Link>
          </p>
          <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground" data-testid="studio-comment-text">{comment.text}</p>
          {isTopLevel && comment.repliesCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{replies}</p>}
          {heldByModeration && (
            <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground" data-testid="studio-comment-held-moderation">
              <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {text.heldByModeration}
            </p>
          )}
          {tab === 'removed' && comment.removedAt && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="studio-comment-removed-by">
              {comment.removedBy
                ? text.removedBy.replace('{time}', formatRelativeTime(comment.removedAt, lang)).split('{name}').flatMap((part, i) => (i === 0 ? [part] : [<bdi key="n">{comment.removedBy!.displayName}</bdi>, part]))
                : text.removedByChannel.replace('{time}', formatRelativeTime(comment.removedAt, lang))}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tab === 'held' && !heldByModeration && (
              <Button size="sm" className="min-h-11" disabled={busy} onClick={onApprove} data-testid="studio-comment-approve">
                <Check aria-hidden="true" className="me-1.5 h-4 w-4" />{text.actions.approve}
              </Button>
            )}
            {tab !== 'removed' && !heldByModeration && (
              <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={onRemove} data-testid="studio-comment-remove">
                <Trash2 aria-hidden="true" className="me-1.5 h-4 w-4" />{text.actions.remove}
              </Button>
            )}
            {tab === 'removed' && (
              <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={onRestore} data-testid="studio-comment-restore">
                <RotateCcw aria-hidden="true" className="me-1.5 h-4 w-4" />{text.actions.restore}
              </Button>
            )}
            {canReply && (
              <Button size="sm" variant="ghost" className="hidden min-h-11 md:inline-flex" aria-expanded={replying} onClick={onReply} data-testid="studio-comment-reply">
                <MessageSquareReply aria-hidden="true" className="me-1.5 h-4 w-4" />{text.actions.reply}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="min-h-11 min-w-11" aria-label={text.actions.label} data-testid="studio-comment-more">
                  <MoreVertical aria-hidden="true" className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canReply && (
                  <DropdownMenuItem className="md:hidden" onSelect={onReply}>{text.actions.reply}</DropdownMenuItem>
                )}
                {tab === 'inbox' && isTopLevel && (
                  <DropdownMenuItem onSelect={() => onFlag(comment.isPinned ? 'unpin' : 'pin')} data-testid="studio-comment-pin">
                    {comment.isPinned ? text.actions.unpin : text.actions.pin}
                  </DropdownMenuItem>
                )}
                {tab === 'inbox' && (
                  <DropdownMenuItem onSelect={() => onFlag(comment.isHearted ? 'unheart' : 'heart')} data-testid="studio-comment-heart">
                    {comment.isHearted ? text.actions.unheart : text.actions.heart}
                  </DropdownMenuItem>
                )}
                {tab === 'inbox' && (
                  <DropdownMenuItem onSelect={onHold} data-testid="studio-comment-hold">{text.actions.hide}</DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href={`${base}?tab=${tab}&target=${encodeURIComponent(targetKey)}`} data-testid="studio-comment-only-this">{text.filters.onlyThis}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onReport} data-testid="studio-comment-report">{text.actions.report}</DropdownMenuItem>
                {comment.author.userId && (
                  <DropdownMenuItem onSelect={onBlock} className="text-destructive focus:text-destructive" data-testid="studio-comment-block">{text.actions.block}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {replying && <ReplyForm comment={comment} channel={channel} onDone={onReplied} onCancel={onReply} />}
        </div>
      </div>
    </li>
  );
}

function ReplyForm({ comment, channel, onDone, onCancel }: { comment: StudioComment; channel: { id: string; name: string }; onDone: (ok: boolean) => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const text = t.studio.commentsPage.reply;
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const fieldId = `studio-reply-${comment.id}`;
  // Replies are one level deep: a reply to a reply goes under its top-level comment
  const parentId = comment.parentId ?? comment.id;

  const send = async () => {
    const body = value.trim();
    if (!body) return;
    setSending(true);
    let ok = false;
    try {
      if (comment.kind === 'video') {
        ok = (await createComment(comment.targetId, body, channel.id, parentId)).ok;
      } else {
        ok = !!(await createPostComment(channel.id, comment.targetId, { content: body, parentCommentId: parentId }, { channelId: channel.id }))?.success;
      }
    } catch (error) {
      logger.error('[Studio] Reply as channel failed', { channelId: channel.id, kind: comment.kind, error });
    }
    setSending(false);
    if (ok) setValue('');
    onDone(ok);
  };

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => { event.preventDefault(); void send(); }}
      data-testid="studio-comment-reply-form"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
        {text.label.split('{channel}').flatMap((part, i) => (i === 0 ? [part] : [<bdi key="c">{channel.name}</bdi>, part]))}
      </label>
      <textarea
        id={fieldId}
        dir="auto"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        maxLength={10000}
        className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="studio-comment-reply-text"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="min-h-11" disabled={sending || !value.trim()} data-testid="studio-comment-reply-send">{text.send}</Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={onCancel}>{text.cancel}</Button>
      </div>
    </form>
  );
}

function BlockedPeople({ channelId, lang, open, onOpenChange, onNotice }: { channelId: string; lang: 'en' | 'ar'; open: boolean; onOpenChange: (open: boolean) => void; onNotice: (text: string) => void }) {
  const { t } = useLanguage();
  const text = t.studio.commentsPage;
  const [items, setItems] = useState<ChannelBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    setFailed(false);
    listChannelBlocks(channelId).then((list) => {
      if (cancelled) return;
      if (!list) {
        logger.error('[Studio] Blocked people not loaded', { channelId });
        setFailed(true);
      } else setItems(list);
    });
    return () => { cancelled = true; };
  }, [channelId, open]);

  const unblock = async (person: ChannelBlock) => {
    setBusy(person.userId);
    const ok = await unblockFromChannel(channelId, person.userId);
    setBusy(null);
    if (!ok) logger.error('[Studio] Unblock failed', { channelId });
    if (ok) setItems((prev) => prev?.filter((p) => p.userId !== person.userId) ?? null);
    onNotice(ok ? text.done.unblock.replace('{name}', person.displayName) : text.failed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="studio-blocks-dialog">
        <DialogTitle>{text.blocks.title}</DialogTitle>
        <DialogDescription>{text.blocks.body}</DialogDescription>
        {failed ? (
          <p role="alert" className="text-sm text-foreground">{text.loadFailed}</p>
        ) : items === null ? (
          <div role="status" aria-label={t.common.loading} className="h-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="studio-blocks-empty">{text.blocks.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((person) => (
              <li key={person.userId} className="flex items-center gap-3 py-2" data-testid="studio-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={person.avatarUrl || DEFAULT_AVATAR} alt="" className="h-8 w-8 rounded-full bg-muted object-cover" />
                <div className="min-w-0 flex-1">
                  <bdi className="block truncate text-sm font-medium text-foreground">{person.displayName}</bdi>
                  <span className="text-xs text-muted-foreground">{text.blocks.since.replace('{time}', formatRelativeTime(person.blockedAt, lang))}</span>
                </div>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy === person.userId} onClick={() => void unblock(person)} data-testid="studio-unblock">{text.blocks.unblock}</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)}>{text.blocks.close}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
