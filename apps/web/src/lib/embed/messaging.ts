/**
 * Embed player postMessage API (docs/embeds/README.md §5).
 *
 * One partner origin is fixed at load time. Events go only to it (never "*")
 * and commands are accepted only from window.parent with exactly that origin.
 */

import { normalizeOrigin } from './params';

export const MESSAGE_PREFIX = 'aun:v1:';
export const EVENT_TYPE = 'aun:v1:event';
export const COMMAND_TYPE = 'aun:v1:command';
export const RESIZE_TYPE = 'aun:v1:resize';

export type EmbedEventName = 'ready' | 'play' | 'pause' | 'ended' | 'timeupdate' | 'error';
export type EmbedCommandName = 'play' | 'pause' | 'seek' | 'mute' | 'unmute' | 'getState';
export type EmbedErrorCode = 'unavailable' | 'media' | 'network' | 'unknown';

export interface EmbedState {
  videoId: string;
  playlistId?: string;
  currentTime: number;
  duration: number | null;
  muted: boolean;
}

export interface EmbedEventMessage extends EmbedState {
  type: typeof EVENT_TYPE;
  event: EmbedEventName;
  error?: { code: EmbedErrorCode; message?: string };
}

export interface EmbedCommandMessage {
  type: typeof COMMAND_TYPE;
  command: EmbedCommandName;
  seconds?: number;
}

const COMMANDS: readonly EmbedCommandName[] = ['play', 'pause', 'seek', 'mute', 'unmute', 'getState'];

export interface PartnerOriginInput {
  /** `origin` query parameter, already normalized (or null) */
  originParam: string | null;
  /** location.ancestorOrigins as an array (Chromium/WebKit), empty when unsupported */
  ancestorOrigins: readonly string[];
  /** document.referrer */
  referrer: string;
}

/**
 * The origin allowed to talk to the player, or null (API off).
 * The `origin` param is trusted only when the browser cannot tell us the real
 * embedder, or when it matches it: a page cannot claim another site's origin.
 */
export function resolvePartnerOrigin({ originParam, ancestorOrigins, referrer }: PartnerOriginInput): string | null {
  const ancestor = normalizeOrigin(ancestorOrigins[0]);
  if (ancestor) {
    return originParam && originParam !== ancestor ? null : ancestor;
  }
  if (originParam) return originParam;
  return normalizeOrigin(referrer);
}

/** The embedding page's origin for analytics: the real ancestor when known, else the referrer origin. */
export function embedderOrigin(ancestorOrigins: readonly string[], referrer: string): string | null {
  return normalizeOrigin(ancestorOrigins[0]) ?? normalizeOrigin(referrer);
}

/** Validate an incoming message. Returns the command or null. */
export function parseCommand(data: unknown): EmbedCommandMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.type !== COMMAND_TYPE) return null;
  const command = message.command as EmbedCommandName;
  if (!COMMANDS.includes(command)) return null;
  if (command === 'seek') {
    const seconds = Number(message.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return { type: COMMAND_TYPE, command, seconds };
  }
  return { type: COMMAND_TYPE, command };
}

export function buildEvent(
  event: EmbedEventName,
  state: EmbedState,
  error?: { code: EmbedErrorCode; message?: string },
): EmbedEventMessage {
  const message: EmbedEventMessage = {
    type: EVENT_TYPE,
    event,
    videoId: state.videoId,
    currentTime: Math.round((Number.isFinite(state.currentTime) ? state.currentTime : 0) * 1000) / 1000,
    duration: state.duration !== null && Number.isFinite(state.duration) && state.duration > 0 ? state.duration : null,
    muted: state.muted,
  };
  if (state.playlistId) message.playlistId = state.playlistId;
  if (error) message.error = error;
  return message;
}

/** Read the browser's ancestor origins (empty where unsupported, e.g. Firefox). */
export function readAncestorOrigins(): string[] {
  try {
    const list = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (!list) return [];
    return Array.from({ length: list.length }, (_, i) => list.item(i) || '').filter(Boolean);
  } catch {
    return [];
  }
}
