'use client';

/**
 * Manage actions on the channel page header and channel cards (Story 29.1):
 * "Customize channel", "Manage videos" and an overflow menu with
 * "Channel settings" and "Delete channel". Each follows the viewer's channel
 * role: a channel admin customizes and manages videos, an editor manages
 * videos, and only the owner deletes. Direction-aware (LTR/RTL).
 */

import React, { useState } from 'react';
import Link from '@/components/common/AppLink';
import { MoreVertical, Pencil, Settings, Trash2, Video } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/hooks/useLanguage';
import { DeleteChannelDialog, type DeletableChannel } from '@/components/channelManagement/DeleteChannelDialog';
import { cn } from '@/lib/utils';
import { can, type ChannelRole } from '@al-ummah/shared-types';

interface ChannelOwnerActionsProps {
  channel: DeletableChannel;
  /** The viewer's role on the channel (default owner) */
  role?: ChannelRole;
  /** `header`: full buttons; `compact`: a "Manage" link plus the overflow menu (cards) */
  variant?: 'header' | 'compact';
  className?: string;
  onDeleted?: (channelId: string) => void | Promise<void>;
  /** Where to go after deleting (see DeleteChannelDialog) */
  redirectAfterDelete?: string | false;
}

const buttonClass =
  'inline-flex items-center gap-2 min-h-9 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

export function ChannelOwnerActions({ channel, role = 'owner', variant = 'header', className, onDeleted, redirectAfterDelete }: ChannelOwnerActionsProps) {
  const { t, lang, isRTL, dir } = useLanguage();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const base = `/${lang}/settings/channel/${channel.id}`;
  // Studio is the channel's creator home (manage = Studio)
  const studio = `/${lang}/studio/${encodeURIComponent(channel.id)}`;
  const channelName = channel.nameLocalized?.[lang] || channel.name;
  const canCustomize = can(role, 'channel.edit');
  const canManageVideos = can(role, 'video.edit');
  const canDelete = can(role, 'channel.delete');

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      dir={dir}
      data-testid={variant === 'header' ? 'channel-owner-actions' : 'channel-card-owner-actions'}
      data-role={role}
      onClick={(e) => e.stopPropagation()}
    >
      {variant === 'header' ? (
        <>
          {canCustomize && (
            <Link href={`${base}/edit`} className={buttonClass} data-testid="channel-customize">
              <Pencil className="w-4 h-4" aria-hidden="true" />
              {t.channel.customizeChannel}
            </Link>
          )}
          {canManageVideos && (
            <Link href={`${studio}/content/videos`} className={buttonClass} data-testid="channel-manage-videos">
              <Video className="w-4 h-4" aria-hidden="true" />
              {t.channel.manageVideos}
            </Link>
          )}
        </>
      ) : (
        <Link
          href={`${studio}/dashboard`}
          className={buttonClass}
          aria-label={`${t.channel.manage}: ${channelName}`}
          data-testid="channel-card-manage"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
          {t.channel.manage}
        </Link>
      )}

      <DropdownMenu dir={dir}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonClass, 'px-2')}
            aria-label={variant === 'header' ? t.channel.moreActions : `${t.channel.moreActions}: ${channelName}`}
            data-testid="channel-more-actions"
          >
            <MoreVertical className="w-4 h-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="min-w-48">
          <DropdownMenuItem asChild>
            <Link href={base} className="flex items-center gap-2 cursor-pointer" data-testid="channel-settings-link">
              <Settings className="w-4 h-4" aria-hidden="true" />
              {t.channel.channelSettings}
            </Link>
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center gap-2 text-red-600 dark:text-red-400 focus:text-red-700 cursor-pointer"
                onSelect={() => setDeleteOpen(true)}
                data-testid="channel-delete-action"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {t.channel.deleteChannel}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canDelete && (
        <DeleteChannelDialog
          channel={channel}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          redirectTo={redirectAfterDelete}
          onDeleted={onDeleted ? ({ channelId }) => onDeleted(channelId) : undefined}
        />
      )}
    </div>
  );
}

export default ChannelOwnerActions;
