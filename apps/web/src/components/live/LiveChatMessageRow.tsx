'use client';

/** One live chat message (wiki E17 §5.2): who, what, and what the viewer may do about it. */
import { formatClock, type LiveChatMessage } from '@al-ummah/shared-types';
import { Ban, Flag, MoreVertical, Pin, PinOff, Trash2 } from 'lucide-react';
import { ComposerAvatar } from '@/components/comments-shared/ComposerAvatar';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/hooks/useLanguage';

export type ChatRowAction = 'pin' | 'unpin' | 'remove' | 'block_author' | 'report';

export interface LiveChatMessageRowProps {
  message: LiveChatMessage;
  /** The viewer's own id; null signed out */
  userId: string | null;
  canModerate: boolean;
  pinned: boolean;
  /** The time in the recording, in a replay */
  showTime?: boolean;
  /** None: no menu (a replay) */
  onAction?: (action: ChatRowAction, message: LiveChatMessage) => void;
}

export function LiveChatMessageRow({ message, userId, canModerate, pinned, showTime = false, onAction }: LiveChatMessageRowProps) {
  const { t, lang } = useLanguage();
  const text = t.liveWatch;
  const own = !!userId && message.userId === userId;
  const items: Array<{ action: ChatRowAction; label: string; icon: typeof Pin; danger?: boolean }> = [];
  if (onAction && userId) {
    if (canModerate) items.push(pinned ? { action: 'unpin', label: text.chatUnpin, icon: PinOff } : { action: 'pin', label: text.chatPin, icon: Pin });
    if (canModerate || own) items.push({ action: 'remove', label: text.chatRemove, icon: Trash2, danger: true });
    // The team is never blocked (the server refuses it)
    if (canModerate && !own && !message.authorRole) items.push({ action: 'block_author', label: text.chatBlock, icon: Ban, danger: true });
    if (!own) items.push({ action: 'report', label: text.chatReport, icon: Flag });
  }
  return (
    <li className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 focus-within:bg-muted/50" data-testid="live-chat-message" data-message-id={message.id}>
      <ComposerAvatar src={message.authorAvatar} name={message.authorName} as="member" className="mt-0.5 h-6 w-6" testId="live-chat-avatar" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="me-1.5 inline-flex max-w-full flex-wrap items-center gap-1 align-baseline">
          {showTime && <span className="text-xs tabular-nums text-muted-foreground">{formatClock(lang, Math.floor(Math.max(0, message.offsetMs) / 1000))}</span>}
          <span className="max-w-full break-words font-semibold text-muted-foreground" dir="auto">{message.authorName}</span>
          {message.authorRole && (
            <Badge variant={message.authorRole === 'owner' ? 'default' : 'outline'} className="px-1.5 py-0 text-xs" data-testid="live-chat-role">
              {message.authorRole === 'owner' ? text.chatOwner : text.chatModerator}
            </Badge>
          )}
        </span>
        <span className="break-words text-foreground [overflow-wrap:anywhere]" dir="auto" data-testid="live-chat-text">{message.text}</span>
      </div>
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={text.chatActions.replace('{name}', message.authorName)}
            data-testid="live-chat-menu"
          >
            <MoreVertical aria-hidden="true" className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map(({ action, label, icon: Icon, danger }) => (
              <DropdownMenuItem key={action} variant={danger ? 'destructive' : 'default'} onSelect={() => onAction!(action, message)} data-testid={`live-chat-${action}`}>
                <Icon aria-hidden="true" className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
