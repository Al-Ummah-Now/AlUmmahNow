'use client';

/**
 * Admin handle tools (wiki AUN-CHANNEL-CLAIM §4), super admins only (admin-api checks
 * channels:transfer too): give the channel one of the official handles, taking it back from a
 * channel that claimed it before it was reserved (that channel gets a default handle and its
 * owner is told), or release the channel's handle (it gets a default one at once). Each asks for
 * a reason in the app's own dialog; the reason goes to the audit log.
 */
import { useId, useState } from 'react';
import { OFFICIAL_CHANNEL_HANDLES } from '@al-ummah/shared-types';
import { releaseChannelHandle, takeOfficialHandle } from '@/lib/api/content';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { SectionCard } from '@/components/content/parts';
import { Select } from '@/components/select/Select';
import { bidiIsolate } from '@/components/content/transfer-model';

const REASON = { reasonMinLength: 10, reasonMaxLength: 500 } as const;

export function ChannelHandleTools({ channel }: { channel: { id: string; handle: string | null } }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const current = channel.handle ?? '';
  const choices = OFFICIAL_CHANNEL_HANDLES.filter((h) => h !== current.toLowerCase());
  const [picked, setPicked] = useState<string>(choices[0] ?? '');
  // After a take the page refreshes with the new current handle, which leaves the list: fall back to the first choice
  const official = (choices as readonly string[]).includes(picked) ? picked : (choices[0] ?? '');
  const at = (handle: string) => bidiIsolate(`@${handle}`, locale);

  return (
    <SectionCard title={t('channels.handleTools.title')} id={`${ids}-handles`} testId="channel-handle-tools">
      <p className="text-sm text-fg-muted mb-3">{t('channels.handleTools.hint')}</p>
      <ActionFeedback error={error} message={message} testId="channel-handle-tools-feedback" />
      <p className="text-sm mb-4">
        {t('channels.handleTools.current')}{' '}
        <span dir="ltr" className="font-medium" data-testid="channel-handle-current">
          {current ? `@${current}` : t('content.none')}
        </span>
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-official`} className="text-sm text-fg-muted">
              {t('channels.handleTools.officialLabel')}
            </label>
            <Select id={`${ids}-official`} value={official} onChange={(e) => setPicked(e.target.value)} className={`${fieldClass} min-w-48`} disabled={!!busy} data-testid="channel-handle-official">
              {choices.map((h) => (
                // Isolated so the @ stays in front in Arabic
                <option key={h} value={h}>
                  {at(h)}
                </option>
              ))}
            </Select>
          </div>
          <ConfirmButton
            label={t('channels.handleTools.take')}
            title={t('channels.handleTools.takeTitle', { handle: at(official) })}
            body={t('channels.handleTools.takeBody', { handle: at(official) })}
            bullets={[t('channels.handleTools.takeHolder'), t('channels.handleTools.takeOld')]}
            confirmLabel={t('channels.handleTools.take')}
            withReason
            reasonHint={t('channels.handleTools.reasonHint')}
            {...REASON}
            disabled={!!busy || !official}
            busy={busy === 'take'}
            testId="channel-handle-take"
            onConfirm={(reason) => run('take', () => takeOfficialHandle(channel.id, official, reason), { success: t('channels.handleTools.taken', { handle: at(official) }) })}
          />
        </div>
        <ConfirmButton
          label={t('channels.handleTools.release')}
          title={t('channels.handleTools.releaseTitle', { handle: at(current) })}
          body={t('channels.handleTools.releaseBody')}
          bullets={[t('channels.handleTools.releaseOld')]}
          confirmLabel={t('channels.handleTools.release')}
          withReason
          reasonHint={t('channels.handleTools.reasonHint')}
          {...REASON}
          danger
          disabled={!!busy || !current}
          busy={busy === 'release'}
          testId="channel-handle-release"
          onConfirm={(reason) => run('release', () => releaseChannelHandle(channel.id, reason), { success: t('channels.handleTools.released') })}
        />
      </div>
    </SectionCard>
  );
}
