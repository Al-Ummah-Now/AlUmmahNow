'use client';

/**
 * How many channel invitations are waiting for the signed-in account (the
 * account menu's "Channel invitations (n)"). Loaded when `active` turns true
 * (the menu opens) and again whenever the Invitations page settles one.
 * A failed count shows nothing: it is reported by the request helper.
 */

import { useEffect, useState } from 'react';
import { loadMyInvites } from './team';

/** Window event the Invitations page fires after an accept or decline. */
export const CHANNEL_INVITES_CHANGED = 'aun:channel-invites-changed';

export function useChannelInviteCount(signedIn: boolean, active: boolean): number {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANNEL_INVITES_CHANGED, bump);
    return () => window.removeEventListener(CHANNEL_INVITES_CHANGED, bump);
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    if (!active && version === 0) return;
    let cancelled = false;
    loadMyInvites()
      .then((invites) => { if (!cancelled) setCount(invites.length); })
      .catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; };
  }, [signedIn, active, version]);

  return count;
}
