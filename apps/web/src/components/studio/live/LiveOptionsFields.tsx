'use client';

/** What a stream's team sets on it (wiki E17): its event tag, and its chat. Each only while it is on for the channel. */
import { useId } from 'react';
import { DEFAULT_LIVE_CHAT_AI_HOLD, LIVE_CHAT_AI_HOLDS, LIVE_CHAT_SLOW_MODES, LIVE_EVENT_LABELS, LIVE_EVENT_TYPES, fillTemplate, isLiveEventType, type LiveChatAiHold, type LiveChatSlowMode, type LiveEventType } from '@al-ummah/shared-types';
import { Switch } from '@/components/common/Switch';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useLanguage } from '@/hooks/useLanguage';
import type { LiveStreamRow } from '@/lib/live/api';
import type { LiveOffers } from '@/lib/studio/nav';

export interface LiveOptionsValue {
  eventType: LiveEventType | null;
  chat: { allowChat: boolean; chatReplay: boolean; slowModeSeconds: LiveChatSlowMode; subscribersOnly: boolean; aiHold: LiveChatAiHold };
}

/** A stream's own, or those of a new one. */
export const optionsOf = (stream?: LiveStreamRow | null): LiveOptionsValue => ({
  eventType: stream?.eventType ?? null,
  chat: {
    allowChat: stream?.allowChat !== false,
    chatReplay: stream?.chatReplay !== false,
    slowModeSeconds: (LIVE_CHAT_SLOW_MODES as readonly number[]).includes(stream?.slowModeSeconds ?? 0) ? ((stream?.slowModeSeconds ?? 0) as LiveChatSlowMode) : 0,
    subscribersOnly: stream?.subscribersOnly === true,
    aiHold: stream?.aiHold ?? DEFAULT_LIVE_CHAT_AI_HOLD,
  },
});

/** The part of it that is offered, as the API takes it. */
export const offeredOptions = (value: LiveOptionsValue, offers: LiveOffers) => ({
  ...(offers.events && value.eventType ? { eventType: value.eventType } : {}),
  ...(offers.chat ? { chat: value.chat } : {}),
});

export function LiveOptionsFields({ value, onChange, offers }: { value: LiveOptionsValue; onChange: (value: LiveOptionsValue) => void; offers: LiveOffers }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const id = useId();
  const chat = (patch: Partial<LiveOptionsValue['chat']>) => onChange({ ...value, chat: { ...value.chat, ...patch } });
  const toggle = (key: 'allowChat' | 'chatReplay' | 'subscribersOnly', label: string) => (
    <div className="flex items-center gap-3">
      <Switch id={`${id}-${key}`} checked={value.chat[key]} onCheckedChange={(on) => chat({ [key]: on })} aria-labelledby={`${id}-${key}-label`} data-testid={`studio-live-${key}`} />
      <span id={`${id}-${key}-label`} className="text-sm text-foreground">{label}</span>
    </div>
  );
  return (
    <>
      {offers.events && (
        <div className="grid gap-1 sm:max-w-sm">
          <label htmlFor={`${id}-event`} id={`${id}-event-label`} className="text-sm font-medium text-foreground">{text.eventType}</label>
          <ThemedSelectField id={`${id}-event`} aria-labelledby={`${id}-event-label ${id}-event`} className="w-full" value={value.eventType ?? ''} onChange={(e) => onChange({ ...value, eventType: isLiveEventType(e.target.value) ? e.target.value : null })} data-testid="studio-live-event">
            <option value="">{text.eventNone}</option>
            {LIVE_EVENT_TYPES.map((type) => <option key={type} value={type}>{LIVE_EVENT_LABELS[type][lang]}</option>)}
          </ThemedSelectField>
        </div>
      )}
      {offers.chat && (
        <fieldset className="grid gap-3 border-t border-border pt-3" data-testid="studio-live-chat-fields">
          <legend className="float-start mb-1 w-full text-sm font-semibold text-foreground">{text.chat}</legend>
          {toggle('allowChat', text.allowChat)}
          {toggle('chatReplay', text.chatReplay)}
          {value.chat.allowChat && (
            <>
              {toggle('subscribersOnly', text.subscribersOnly)}
              <div className="grid gap-1 sm:max-w-sm">
                <label htmlFor={`${id}-slow`} id={`${id}-slow-label`} className="text-sm text-foreground">{text.slowMode}</label>
                <ThemedSelectField id={`${id}-slow`} aria-labelledby={`${id}-slow-label ${id}-slow`} className="w-full" value={String(value.chat.slowModeSeconds)} onChange={(e) => chat({ slowModeSeconds: Number(e.target.value) as LiveChatSlowMode })} data-testid="studio-live-slow">
                  {LIVE_CHAT_SLOW_MODES.map((s) => <option key={s} value={String(s)}>{s === 0 ? text.slowModeOff : fillTemplate(lang, text.slowModeEvery, { seconds: s })}</option>)}
                </ThemedSelectField>
              </div>
              <div className="grid gap-1 sm:max-w-sm">
                <label htmlFor={`${id}-hold`} id={`${id}-hold-label`} className="text-sm text-foreground">{text.aiHold}</label>
                <ThemedSelectField id={`${id}-hold`} aria-labelledby={`${id}-hold-label ${id}-hold`} className="w-full" value={value.chat.aiHold} onChange={(e) => chat({ aiHold: e.target.value as LiveChatAiHold })} data-testid="studio-live-hold">
                  {LIVE_CHAT_AI_HOLDS.map((hold) => <option key={hold} value={hold}>{hold === 'none' ? text.aiHoldNone : hold === 'basic' ? text.aiHoldBasic : text.aiHoldStrict}</option>)}
                </ThemedSelectField>
                <p className="text-xs text-muted-foreground">{text.aiHoldHelp}</p>
              </div>
            </>
          )}
        </fieldset>
      )}
    </>
  );
}
