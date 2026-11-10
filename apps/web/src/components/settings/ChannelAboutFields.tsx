'use client';

/**
 * Channel settings fields for Story 29.1: @handle (with live availability
 * check), About links, contact email and location. Controlled component;
 * direction-aware (handles and URLs are always LTR).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { checkHandleAvailability, type ChannelLink, type HandleProblem } from '@/lib/api/channel-profile';
import { HANDLE_MAX_LENGTH, localHandleProblem } from '@/lib/channel-url';
import { logger } from '@/lib/logger-client';

export const MAX_CHANNEL_LINKS = 10;

export interface ChannelAboutValues {
  handle: string;
  links: ChannelLink[];
  contactEmail: string;
  location: string;
}

export type HandleStatus =
  | { state: 'idle' | 'checking' | 'current' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: HandleProblem };

interface ChannelAboutFieldsProps {
  channelId: string;
  /** The channel's saved handle (counts as available) */
  currentHandle?: string;
  value: ChannelAboutValues;
  onChange: (value: ChannelAboutValues) => void;
  onHandleStatusChange?: (status: HandleStatus) => void;
  disabled?: boolean;
  /** The handle is read-only (only the channel owner changes it) */
  handleLocked?: boolean;
}

const inputClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidLink(link: ChannelLink): boolean {
  return link.title.trim().length > 0 && /^https?:\/\/\S+$/i.test(link.url.trim());
}

export function isValidContactEmail(email: string): boolean {
  return email.trim() === '' || EMAIL_PATTERN.test(email.trim());
}

export function ChannelAboutFields({ channelId, currentHandle, value, onChange, onHandleStatusChange, disabled, handleLocked }: ChannelAboutFieldsProps) {
  const { t, lang } = useLanguage();
  const ids = { handle: useId(), handleHelp: useId(), handleStatus: useId(), email: useId(), emailHelp: useId(), location: useId(), links: useId() };
  const [status, setStatus] = useState<HandleStatus>({ state: 'idle' });
  const statusRef = useRef(onHandleStatusChange);
  useEffect(() => {
    statusRef.current = onHandleStatusChange;
  }, [onHandleStatusChange]);

  const update = (patch: Partial<ChannelAboutValues>) => onChange({ ...value, ...patch });
  const normalizedHandle = value.handle.trim().replace(/^@+/, '');

  // Debounced availability check (format problems are reported without a request)
  useEffect(() => {
    let cancelled = false;
    const report = (next: HandleStatus) => {
      if (cancelled) return;
      setStatus(next);
      statusRef.current?.(next);
    };
    if (!normalizedHandle || (currentHandle && normalizedHandle === currentHandle)) {
      report({ state: currentHandle && normalizedHandle === currentHandle ? 'current' : 'idle' });
      return () => { cancelled = true; };
    }
    const local = localHandleProblem(normalizedHandle);
    if (local) {
      report({ state: 'unavailable', reason: local });
      return () => { cancelled = true; };
    }
    report({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await checkHandleAvailability(normalizedHandle, channelId);
        if (!result) {
          report({ state: 'idle' });
          return;
        }
        report(result.available ? { state: 'available' } : { state: 'unavailable', reason: result.reason || 'taken' });
      } catch (error) {
        logger.warn('[ChannelAboutFields] Availability check failed', { error });
        report({ state: 'idle' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedHandle, currentHandle, channelId]);

  const problemText: Record<HandleProblem, string> = {
    too_short: t.channel.handleTooShort,
    too_long: t.channel.handleTooLong,
    invalid_characters: t.channel.handleInvalid,
    reserved: t.channel.handleReserved,
    taken: t.channel.handleTaken,
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const previewUrl = `${origin}/${lang}/@${normalizedHandle || t.channel.handlePlaceholder}`;
  const emailInvalid = !isValidContactEmail(value.contactEmail);

  return (
    <div className="space-y-6" data-testid="channel-about-fields">
      {/* Handle */}
      <div>
        <label htmlFor={ids.handle} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          {t.channel.handle}
        </label>
        <div className="flex items-stretch" dir="ltr">
          <span className="inline-flex items-center px-3 rounded-s-lg border border-e-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300" aria-hidden="true">@</span>
          <input
            id={ids.handle}
            type="text"
            value={value.handle}
            onChange={(e) => update({ handle: e.target.value.replace(/\s/g, '') })}
            maxLength={HANDLE_MAX_LENGTH + 1}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            readOnly={handleLocked}
            placeholder={t.channel.handlePlaceholder}
            aria-describedby={`${ids.handleHelp} ${ids.handleStatus}`}
            aria-invalid={status.state === 'unavailable'}
            className={`${inputClass} rounded-s-none`}
            data-testid="channel-handle-input"
          />
        </div>
        <p id={ids.handleHelp} className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">
          {t.channel.handleHelp.replace('{url}', previewUrl)}
        </p>
        <p id={ids.handleStatus} className="text-sm mt-1" aria-live="polite" data-testid="channel-handle-status" data-state={status.state}>
          {status.state === 'checking' && <span className="text-gray-500 dark:text-gray-400">{t.channel.handleChecking}</span>}
          {status.state === 'available' && <span className="text-green-700 dark:text-green-400">{t.channel.handleAvailable.replace('{handle}', normalizedHandle)}</span>}
          {status.state === 'current' && <span className="text-gray-500 dark:text-gray-400">{t.channel.handleCurrent}</span>}
          {status.state === 'unavailable' && <span className="text-red-600 dark:text-red-400">{problemText[status.reason]}</span>}
        </p>
      </div>

      {/* Links */}
      <fieldset>
        <legend className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t.channel.links}</legend>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{t.channel.linksHelp.replace('{max}', String(MAX_CHANNEL_LINKS))}</p>
        <ul className="space-y-2" id={ids.links}>
          {value.links.map((link, index) => {
            const invalid = (link.title.trim() !== '' || link.url.trim() !== '') && !isValidLink(link);
            return (
              <li key={index} className="flex flex-col sm:flex-row gap-2" data-testid="channel-link-row">
                <input
                  type="text"
                  value={link.title}
                  maxLength={50}
                  disabled={disabled}
                  aria-label={`${t.channel.linkTitle} ${index + 1}`}
                  placeholder={t.channel.linkTitle}
                  onChange={(e) => update({ links: value.links.map((l, i) => (i === index ? { ...l, title: e.target.value } : l)) })}
                  className={`${inputClass} sm:w-1/3`}
                />
                <input
                  type="url"
                  inputMode="url"
                  dir="ltr"
                  value={link.url}
                  maxLength={500}
                  disabled={disabled}
                  aria-label={`${t.channel.linkUrl} ${index + 1}`}
                  aria-invalid={invalid}
                  placeholder="https://"
                  onChange={(e) => update({ links: value.links.map((l, i) => (i === index ? { ...l, url: e.target.value.trim() } : l)) })}
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => update({ links: value.links.filter((_, i) => i !== index) })}
                  disabled={disabled}
                  aria-label={t.channel.removeLink.replace('{n}', String(index + 1))}
                  className="inline-flex items-center justify-center min-h-10 min-w-10 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
                {invalid && <p className="text-sm text-red-600 dark:text-red-400 sm:hidden" role="alert">{t.channel.invalidLinkUrl}</p>}
              </li>
            );
          })}
        </ul>
        {value.links.some((l) => (l.title.trim() !== '' || l.url.trim() !== '') && !isValidLink(l)) && (
          <p className="hidden sm:block text-sm text-red-600 dark:text-red-400 mt-1" role="alert">{t.channel.invalidLinkUrl}</p>
        )}
        {value.links.length < MAX_CHANNEL_LINKS && (
          <button
            type="button"
            onClick={() => update({ links: [...value.links, { title: '', url: '' }] })}
            disabled={disabled}
            className="mt-2 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            data-testid="channel-add-link"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t.channel.addLink}
          </button>
        )}
      </fieldset>

      {/* Contact email */}
      <div>
        <label htmlFor={ids.email} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          {t.channel.contactEmail}
        </label>
        <input
          id={ids.email}
          type="email"
          dir="ltr"
          value={value.contactEmail}
          maxLength={254}
          disabled={disabled}
          aria-describedby={ids.emailHelp}
          aria-invalid={emailInvalid}
          onChange={(e) => update({ contactEmail: e.target.value.trim() })}
          className={inputClass}
          data-testid="channel-contact-input"
        />
        <p id={ids.emailHelp} className={`text-sm mt-1 ${emailInvalid ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {emailInvalid ? t.channel.invalidEmail : t.channel.contactEmailHelp}
        </p>
      </div>

      {/* Location */}
      <div>
        <label htmlFor={ids.location} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          {t.channel.location}
        </label>
        <input
          id={ids.location}
          type="text"
          value={value.location}
          maxLength={100}
          disabled={disabled}
          placeholder={t.channel.locationPlaceholder}
          onChange={(e) => update({ location: e.target.value })}
          className={inputClass}
          data-testid="channel-location-input"
        />
      </div>
    </div>
  );
}

/** True when the About fields can be submitted. */
export function canSubmitAboutFields(value: ChannelAboutValues, status: HandleStatus): boolean {
  const linksOk = value.links.every((l) => (l.title.trim() === '' && l.url.trim() === '') || isValidLink(l));
  const handleOk = status.state !== 'unavailable' && status.state !== 'checking';
  return linksOk && handleOk && isValidContactEmail(value.contactEmail);
}

export default ChannelAboutFields;
