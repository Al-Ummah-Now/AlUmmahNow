'use client';

/**
 * The channel's About details (Story 29.1) edited where they appear: links,
 * contact email and location, laid out like the public About tab. In edit
 * mode each link row opens in place (title + URL), and contact/location are
 * inline fields. Controlled: values are drafts saved by the page.
 * Handles and URLs are always LTR.
 */

import React, { useState } from 'react';
import { Link2, Mail, MapPin, Pencil, Plus, Trash2, Check } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { ChannelLink } from '@/lib/api/channel-profile';
import { InlineEditField } from '@/components/inlineEdit/InlineEditField';
import type { HandleStatus } from '@/components/settings/useHandleAvailability';
import { cn } from '@/lib/utils';

export type { HandleStatus } from '@/components/settings/useHandleAvailability';

export const MAX_CHANNEL_LINKS = 10;

export interface ChannelAboutValues {
  handle: string;
  links: ChannelLink[];
  contactEmail: string;
  location: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidLink(link: ChannelLink): boolean {
  return link.title.trim().length > 0 && /^https?:\/\/\S+$/i.test(link.url.trim());
}

export function isValidContactEmail(email: string): boolean {
  return email.trim() === '' || EMAIL_PATTERN.test(email.trim());
}

/** A row the owner started filling in but that is not a valid link yet */
export function isIncompleteLink(link: ChannelLink): boolean {
  return (link.title.trim() !== '' || link.url.trim() !== '') && !isValidLink(link);
}

/** True when the About fields can be submitted. */
export function canSubmitAboutFields(value: ChannelAboutValues, status: HandleStatus): boolean {
  const linksOk = value.links.every((l) => !isIncompleteLink(l));
  const handleOk = status.state !== 'unavailable' && status.state !== 'checking';
  return linksOk && handleOk && isValidContactEmail(value.contactEmail);
}

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type AboutDetails = Omit<ChannelAboutValues, 'handle'>;

interface ChannelAboutFieldsProps {
  value: AboutDetails;
  onChange: (patch: Partial<AboutDetails>) => void;
  editable: boolean;
  dirty?: Partial<Record<keyof AboutDetails, boolean>>;
}

const inputClass =
  'w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base ' +
  'focus:outline-none focus:border-[var(--inline-edit-ring)] focus:shadow-[0_0_0_4px_var(--inline-edit-glow)]';

export function ChannelAboutFields({ value, onChange, editable, dirty }: ChannelAboutFieldsProps) {
  const { t } = useLanguage();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const links = value.links;

  const setLink = (index: number, patch: Partial<ChannelLink>) =>
    onChange({ links: links.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const removeLink = (index: number) => {
    onChange({ links: links.filter((_, i) => i !== index) });
    setOpenRow(null);
  };

  const addLink = () => {
    onChange({ links: [...links, { title: '', url: '' }] });
    setOpenRow(links.length);
  };

  const closeRow = (index: number) => {
    // An untouched new row disappears when closed
    const link = links[index];
    if (link && !link.title.trim() && !link.url.trim()) removeLink(index);
    else setOpenRow(null);
  };

  const emailInvalid = !isValidContactEmail(value.contactEmail);

  return (
    <section aria-labelledby="about-editor-heading" className="space-y-8" data-testid="channel-about-fields">
      <div>
        <h2 id="about-editor-heading" className="text-xl font-semibold text-gray-900 dark:text-white">
          {t.inlineEdit.aboutHeading}
        </h2>
        {editable && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t.inlineEdit.aboutHelp}</p>}
      </div>

      {/* Links */}
      <section aria-labelledby="about-editor-links" className={cn(dirty?.links && 'ps-3 border-s-2 border-[var(--inline-edit-ring)]')}>
        <h3 id="about-editor-links" className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
          {t.channel.links}
          {editable && <span className="font-normal"> · {t.channel.linksHelp.replace('{max}', String(MAX_CHANNEL_LINKS))}</span>}
        </h3>
        {links.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{editable ? t.inlineEdit.noLinks : t.channel.noLinks}</p>}
        <ul className="space-y-1">
          {links.map((link, index) => {
            const incomplete = isIncompleteLink(link);
            const open = editable && (openRow === index || incomplete);
            const n = String(index + 1);
            return (
              <li key={index} data-testid="channel-link-row">
                {open ? (
                  <div className="inline-edit-target p-3" data-editing="true" data-invalid={incomplete ? 'true' : undefined}>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={link.title}
                        maxLength={50}
                        aria-label={`${t.channel.linkTitle} ${n}`}
                        placeholder={t.channel.linkTitle}
                        onChange={(e) => setLink(index, { title: e.target.value })}
                        className={cn(inputClass, 'sm:w-1/3')}
                        autoFocus={!link.title}
                      />
                      <input
                        type="url"
                        inputMode="url"
                        dir="ltr"
                        value={link.url}
                        maxLength={500}
                        aria-label={`${t.channel.linkUrl} ${n}`}
                        aria-invalid={incomplete}
                        placeholder="https://"
                        onChange={(e) => setLink(index, { url: e.target.value.trim() })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !incomplete) closeRow(index);
                        }}
                        className={cn(inputClass, 'flex-1')}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>
                    {incomplete && (
                      <p className="mt-2 text-sm text-[var(--inline-edit-error)]" role="alert">
                        {t.channel.invalidLinkUrl}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => closeRow(index)}
                        disabled={incomplete}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                        {t.inlineEdit.done}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLink(index)}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-border text-sm hover:bg-muted"
                        aria-label={t.channel.removeLink.replace('{n}', n)}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        {t.common.delete}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group flex items-center gap-2 min-h-10">
                    <Link2 className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                    {editable ? (
                      <button type="button" onClick={() => setOpenRow(index)} className="inline-edit-target text-start px-1 -mx-1 text-blue-600 dark:text-blue-400 break-all">
                        {link.title}
                      </button>
                    ) : (
                      <a href={link.url} target="_blank" rel="nofollow noopener noreferrer ugc" className="text-blue-600 dark:text-blue-400 hover:underline break-all">
                        {link.title}
                      </a>
                    )}
                    <span className="ms-1 text-xs text-gray-500 truncate" dir="ltr">{linkHost(link.url)}</span>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => setOpenRow(index)}
                        aria-label={t.inlineEdit.editField.replace('{field}', link.title || `${t.channel.linkTitle} ${n}`)}
                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-[var(--inline-edit-ring)] hover:bg-muted"
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {editable && links.length < MAX_CHANNEL_LINKS && (
          <button
            type="button"
            onClick={addLink}
            className="mt-2 inline-flex items-center gap-2 min-h-10 px-3 rounded-lg border border-dashed border-[var(--inline-edit-hint)] text-sm font-medium text-foreground hover:border-[var(--inline-edit-ring)]"
            data-testid="channel-add-link"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t.channel.addLink}
          </button>
        )}
      </section>

      {/* Contact email and location */}
      <section aria-labelledby="about-editor-details" className="space-y-3">
        <h3 id="about-editor-details" className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {t.channel.aboutDetails}
        </h3>
        <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
          <Mail className="w-4 h-4 mt-1.5 text-gray-500 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <InlineEditField
              value={value.contactEmail}
              dir="ltr"
              onCommit={(v) => onChange({ contactEmail: v.trim() })}
              transform={(v) => v.trim()}
              label={t.channel.contactEmail}
              editable={editable}
              inputType="email"
              maxLength={254}
              validate={(v) => (isValidContactEmail(v) ? null : t.channel.invalidEmail)}
              emptyText={t.inlineEdit.addContactEmail}
              className="text-base"
              dirty={dirty?.contactEmail}
              testId="channel-contact"
              inputTestId="channel-contact-input"
            />
            {editable && <p className={cn('text-xs mt-1', emailInvalid ? 'text-[var(--inline-edit-error)]' : 'text-gray-500 dark:text-gray-400')}>{emailInvalid ? t.channel.invalidEmail : t.channel.contactEmailHelp}</p>}
          </div>
        </div>
        <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
          <MapPin className="w-4 h-4 mt-1.5 text-gray-500 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <InlineEditField
              value={value.location}
              onCommit={(v) => onChange({ location: v.trim() })}
              label={t.channel.location}
              editable={editable}
              maxLength={100}
              placeholder={t.channel.locationPlaceholder}
              emptyText={t.inlineEdit.addLocation}
              className="text-base"
              dirty={dirty?.location}
              testId="channel-location"
              inputTestId="channel-location-input"
            />
          </div>
        </div>
      </section>
    </section>
  );
}

export default ChannelAboutFields;
