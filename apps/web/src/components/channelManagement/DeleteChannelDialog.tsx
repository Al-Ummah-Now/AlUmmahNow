'use client';

/**
 * DeleteChannelDialog (Story 29.1 owner actions)
 *
 * One confirmation flow for every place a channel can be deleted (channel page
 * header, channel directory cards, profile channel management):
 * - explains what is removed (videos, playlists, community posts, @handle)
 * - requires typing the channel name
 * - main channel with other channels: the owner picks the new main channel
 *   (the API promotes it); only channel: deleting leaves the account without
 *   channels, which is allowed
 * - pending state prevents double submits
 * - afterwards reloads the session channels, switches the active channel if it
 *   was the deleted one and redirects to the profile with a success notice
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { deleteOwnedChannel } from '@/lib/api/channel-profile';
import { logger } from '@/lib/logger-client';

export interface DeletableChannel {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  isMain?: boolean;
}

export interface DeleteChannelDialogProps {
  channel: DeletableChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete (before redirecting) */
  onDeleted?: (result: { channelId: string; newMainChannelId: string | null }) => void | Promise<void>;
  /** Where to go afterwards; default /{locale}/profile?channelDeleted=1. `false` stays on the page. */
  redirectTo?: string | false;
}

export const CHANNEL_DELETED_PARAM = 'channelDeleted';

export function DeleteChannelDialog({ channel, open, onOpenChange, onDeleted, redirectTo }: DeleteChannelDialogProps) {
  const { t, lang, dir } = useLanguage();
  const router = useRouter();
  const { user, reloadChannels, switchToChannel } = useMultiAccount();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const inputId = useId();
  const selectId = useId();

  const displayName = channel.nameLocalized?.[lang] || channel.name;
  const otherChannels = useMemo(
    () => (user?.channels || []).filter((ch) => ch.id !== channel.id),
    [user?.channels, channel.id],
  );
  const [newMainId, setNewMainId] = useState<string>('');
  const firstOtherId = otherChannels[0]?.id || '';

  // Reset each time the dialog opens (not on every session refresh)
  useEffect(() => {
    if (open) {
      setTyped('');
      setFailed(false);
    }
  }, [open]);
  useEffect(() => {
    if (open) setNewMainId((current) => (current && otherChannels.some((ch) => ch.id === current) ? current : firstOtherId));
  }, [open, firstOtherId, otherChannels]);

  const nameOf = (ch: { name: string; nameLocalized?: Record<string, string> }) => ch.nameLocalized?.[lang] || ch.name;
  const typedValue = typed.trim();
  const confirmed = typedValue.length > 0 && (typedValue === channel.name.trim() || typedValue === displayName.trim());

  const handleDelete = async () => {
    if (!confirmed || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    try {
      const result = await deleteOwnedChannel(channel.id, channel.isMain ? newMainId || undefined : undefined);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      logger.info('[DeleteChannelDialog] Channel deleted', { channelId: channel.id, newMainChannelId: result.newMainChannelId });

      await reloadChannels();
      if (user?.channel?.id === channel.id) {
        const next = result.newMainChannelId || otherChannels[0]?.id || null;
        await switchToChannel(next);
      }
      await onDeleted?.({ channelId: channel.id, newMainChannelId: result.newMainChannelId });

      onOpenChange(false);
      if (redirectTo !== false) {
        router.push(redirectTo || `/${lang}/profile?${CHANNEL_DELETED_PARAM}=1`);
      }
    } catch (error) {
      logger.error('[DeleteChannelDialog] Delete failed', { channelId: channel.id, error });
      setFailed(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent dir={dir} data-testid="delete-channel-dialog" className={dir === 'rtl' ? 'text-right' : undefined}>
        <DialogHeader className={dir === 'rtl' ? 'sm:text-right' : undefined}>
          <DialogTitle>{t.channel.deleteDialogTitle}</DialogTitle>
          <DialogDescription>
            {t.channel.deleteDialogBody.replace('{name}', displayName)}
          </DialogDescription>
        </DialogHeader>

        {channel.isMain && (
          otherChannels.length > 0 ? (
            <div className="space-y-2">
              <label htmlFor={selectId} className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                {t.channel.newMainChannel}
              </label>
              <select
                id={selectId}
                value={newMainId}
                onChange={(e) => setNewMainId(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                data-testid="delete-channel-new-main"
              >
                {otherChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{nameOf(ch)}</option>
                ))}
              </select>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t.channel.deleteMainNote.replace('{next}', nameOf(otherChannels.find((ch) => ch.id === newMainId) || otherChannels[0]))}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t.channel.deleteOnlyNote}</p>
          )
        )}

        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-900 dark:text-gray-100">
            {t.channel.deleteConfirmLabel.replace('{name}', displayName)}
          </label>
          <input
            id={inputId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleDelete(); } }}
            disabled={pending}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base"
            data-testid="delete-channel-confirm-input"
          />
        </div>

        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{t.channel.deleteFailed}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!confirmed || pending}
            aria-busy={pending}
            data-testid="delete-channel-confirm"
          >
            {pending ? t.channel.deleting : t.channel.deleteConfirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteChannelDialog;
