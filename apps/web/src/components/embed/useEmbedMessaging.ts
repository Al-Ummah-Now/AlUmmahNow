'use client';

/**
 * postMessage bridge between an embed frame and its parent page
 * (docs/embeds/README.md §5). Events go only to the partner origin; commands
 * are accepted only from window.parent with exactly that origin.
 */

import { useCallback, useEffect, useRef } from 'react';
import { logger } from '@/lib/logger-client';
import {
  buildEvent,
  parseCommand,
  readAncestorOrigins,
  resolvePartnerOrigin,
  type EmbedCommandMessage,
  type EmbedErrorCode,
  type EmbedEventName,
  type EmbedState,
} from '@/lib/embed/messaging';

export interface EmbedMessaging {
  emit: (event: EmbedEventName, error?: { code: EmbedErrorCode; message?: string }) => void;
}

export function useEmbedMessaging(
  originParam: string | null,
  getState: () => EmbedState,
  onCommand?: (command: EmbedCommandMessage) => void,
): EmbedMessaging {
  const partnerRef = useRef<string | null | undefined>(undefined);
  const getStateRef = useRef(getState);
  const onCommandRef = useRef(onCommand);
  getStateRef.current = getState;
  onCommandRef.current = onCommand;

  const partner = useCallback((): string | null => {
    if (partnerRef.current === undefined) {
      if (typeof window === 'undefined' || window.parent === window) {
        partnerRef.current = null;
      } else {
        partnerRef.current = resolvePartnerOrigin({
          originParam,
          ancestorOrigins: readAncestorOrigins(),
          referrer: document.referrer,
        });
      }
    }
    return partnerRef.current;
  }, [originParam]);

  const emit = useCallback<EmbedMessaging['emit']>((event, error) => {
    const target = partner();
    if (!target) return;
    try {
      window.parent.postMessage(buildEvent(event, getStateRef.current(), error), target);
    } catch (err) {
      logger.debug('[embed] postMessage failed', { event, err });
    }
  }, [partner]);

  useEffect(() => {
    const target = partner();
    if (!target) return undefined;
    const onMessage = (message: MessageEvent) => {
      if (message.source !== window.parent || message.origin !== target) return;
      const command = parseCommand(message.data);
      if (!command) return;
      if (command.command === 'getState') {
        emit('timeupdate');
        return;
      }
      onCommandRef.current?.(command);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [partner, emit]);

  return { emit };
}
