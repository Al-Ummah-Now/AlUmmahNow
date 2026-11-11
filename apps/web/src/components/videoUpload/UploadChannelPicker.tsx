'use client';

/**
 * The upload page's "Channel" picker: where the video goes.
 *
 * - One eligible channel: a read-only card, so the uploader still sees where
 *   the video goes.
 * - Several: the card plus the shared Autocomplete combobox (ARIA 1.2,
 *   live filtering by name and @handle; the whole list shows while the input
 *   is empty), grouped like the account menu ("Your channels", "Channels you
 *   manage").
 * - `disabled` (an upload has started): the card stays, the combobox is
 *   disabled and a note says why.
 *
 * The page decides what a change means (confirm, reset); this only reports
 * the pick.
 */

import React, { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';
import { channelDisplayName, roleOn, type UploadChannelCandidate } from '@/lib/upload/upload-channel';

export interface UploadChannelPickerProps {
  channels: UploadChannelCandidate[];
  value: string | null;
  onChange: (channelId: string) => void;
  userId?: string;
  disabled?: boolean;
}

function ChannelAvatar({ channel, name, size }: { channel: UploadChannelCandidate; name: string; size: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-8 w-8 text-sm';
  if (channel.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={channel.avatarUrl} alt="" className={`${box} flex-shrink-0 rounded-full object-cover`} onError={() => setFailed(true)} />
    );
  }
  return (
    <span aria-hidden="true" className={`${box} flex flex-shrink-0 items-center justify-center rounded-full bg-[var(--fanous-c-button-primary-bg)] font-semibold text-[var(--fanous-c-button-primary-text)]`}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function UploadChannelPicker({ channels, value, onChange, userId, disabled = false }: UploadChannelPickerProps) {
  const { t, lang } = useLanguage();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const hintId = `${ids}-hint`;
  const [query, setQuery] = useState('');

  const selected = channels.find((c) => c.id === value) ?? null;
  const multiple = channels.length > 1;

  const options = useMemo<AutocompleteOption[]>(() => channels.map((channel) => {
    const name = channelDisplayName(channel, lang);
    const role = roleOn(channel, userId);
    const roleLabel = role && role !== 'owner' ? t.channelRoles.roles[role] : '';
    const subtitle = [channel.handle ? `@${channel.handle}` : '', roleLabel].filter(Boolean).join(' · ');
    return {
      id: channel.id,
      label: name,
      subtitle: subtitle || undefined,
      thumbnailUrl: channel.avatarUrl,
      thumbnailShape: 'round',
      // No avatar: the channel's initial, like the card and the account menu
      icon: (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--fanous-c-button-primary-bg)] text-sm font-semibold text-[var(--fanous-c-button-primary-text)]">
          {(name.trim()[0] ?? '?').toUpperCase()}
        </span>
      ),
      group: role && role !== 'owner' ? 'managed' : 'owned',
      keywords: [channel.handle, channel.handle ? `@${channel.handle}` : null, channel.name, ...Object.values(channel.nameLocalized ?? {})],
      value: channel.id,
    };
  }), [channels, lang, userId, t.channelRoles.roles]);

  const groups = useMemo(() => {
    const hasManaged = options.some((o) => o.group === 'managed');
    if (!hasManaged) return undefined;
    return [
      { key: 'owned', label: t.channelRoles.yourChannels },
      { key: 'managed', label: t.channelRoles.channelsYouManage },
    ];
  }, [options, t.channelRoles.yourChannels, t.channelRoles.channelsYouManage]);

  if (channels.length === 0) return null;

  const selectedName = selected ? channelDisplayName(selected, lang) : '';
  const selectedRole = selected ? roleOn(selected, userId) : undefined;

  return (
    <section
      className="mb-6 rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] p-4 md:p-5"
      aria-labelledby={headingId}
      data-testid="upload-channel-picker"
      data-channel-id={selected?.id ?? ''}
      data-mode={multiple ? 'choose' : 'fixed'}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <h2 id={headingId} className="mb-3 text-sm font-semibold text-[var(--fanous-color-text-primary)]">
        {t.upload.channelPickerLabel}
      </h2>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        {selected && (
          <div
            className="flex min-w-0 flex-1 items-center gap-3"
            data-testid="upload-channel-selected"
            data-channel-id={selected.id}
            aria-live="polite"
          >
            <ChannelAvatar channel={selected} name={selectedName} size="lg" />
            <div className="min-w-0">
              <p className="sr-only">{t.upload.channelPickerSelected.replace('{name}', selectedName)}</p>
              <p className="truncate font-semibold text-[var(--fanous-color-text-primary)]" aria-hidden="true" data-testid="upload-channel-name">
                {selectedName}
              </p>
              {selected.handle && (
                <p className="truncate text-sm text-[var(--fanous-color-text-secondary)]" data-testid="upload-channel-handle">
                  <bdi dir="ltr">@{selected.handle}</bdi>
                </p>
              )}
              {selectedRole && selectedRole !== 'owner' && (
                <p className="text-xs text-[var(--fanous-color-text-muted)]" data-testid="upload-channel-role" data-role={selectedRole}>
                  {t.channelRoles.yourRole.replace('{role}', t.channelRoles.roles[selectedRole])}
                </p>
              )}
            </div>
          </div>
        )}

        {multiple && (
          <div className="w-full md:w-80 md:flex-shrink-0">
            <Autocomplete
              value={query}
              onValueChange={setQuery}
              options={options}
              emptyOptions={options}
              groups={groups}
              maxOptions={50}
              decorate={(option) => ({ selected: option.id === selected?.id })}
              onSelect={(option) => {
                setQuery('');
                if (option.id !== selected?.id) onChange(option.id);
              }}
              label={t.upload.channelPickerSearchLabel}
              testId="upload-channel-combobox"
              optionTestId={(option) => `upload-channel-option-${option.id}`}
              inputClassName="w-full rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] py-2 ps-10 pe-3 text-sm text-[var(--fanous-color-text-primary)] placeholder:text-[var(--fanous-color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--fanous-color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              inputProps={{
                type: 'search',
                placeholder: t.upload.channelPickerSearch,
                disabled,
                'aria-describedby': hintId,
                autoComplete: 'off',
              }}
            >
              <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--fanous-color-text-muted)]" aria-hidden="true" />
            </Autocomplete>
          </div>
        )}
      </div>

      <p id={hintId} className="mt-3 text-xs text-[var(--fanous-color-text-secondary)]" data-testid={disabled ? 'upload-channel-locked' : 'upload-channel-hint'}>
        {disabled && multiple ? t.upload.channelPickerLocked : t.upload.channelPickerHint}
      </p>
    </section>
  );
}

export default UploadChannelPicker;
